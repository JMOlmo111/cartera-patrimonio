/* =========================================================
   Cartera Patrimonio · app (PWA) — Fase 1
   Toda la información procede del backend (Apps Script).
   No se muestra ningún dato inventado: si falta, se indica.
   ========================================================= */
(function () {
  'use strict';

  const CLAVE_CONEXION = 'cp_conexion';
  const CLAVE_CACHE = 'cp_cache_resumen';
  const TITULOS = { patrimonio: 'Mi patrimonio', oro: 'Oro', fondos: 'Fondos indexados', cartera: 'Mi cartera', informes: 'Asesor e informes' };

  const estado = { conexion: null, datos: null, vista: 'patrimonio', graficos: {}, cargando: false, deCache: false };

  /* ---------------- Utilidades ---------------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtEur = (n, dec) => (n === null || n === undefined || isNaN(n)) ? '—' :
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: dec === undefined ? 2 : dec, maximumFractionDigits: dec === undefined ? 2 : dec }).format(n);
  const fmtNum = (n, dec) => (n === null || n === undefined || isNaN(n)) ? '—' :
    new Intl.NumberFormat('es-ES', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }).format(n);
  const fmtPct = (n, dec, signo) => (n === null || n === undefined || isNaN(n)) ? '—' :
    (signo && n > 0 ? '+' : '') + fmtNum(n, dec === undefined ? 2 : dec) + ' %';
  const clase = n => n > 0 ? 'pos' : (n < 0 ? 'neg' : '');
  const fmtFecha = iso => {
    if (!iso) return '—';
    const d = new Date(String(iso).length <= 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtFechaHora = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? esc(iso) : d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const hoyISO = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const leerLS = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const guardarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('visible'), 3200);
  }

  /* ---------------- Comunicación con el backend ---------------- */
  async function api(accion, datos) {
    if (!estado.conexion) throw new Error('Sin conexión configurada.');
    const resp = await fetch(estado.conexion.url, {
      method: 'POST',
      // text/plain evita la comprobación previa CORS, que Apps Script no admite
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: estado.conexion.token, accion: accion, datos: datos || {} }),
      redirect: 'follow'
    });
    if (!resp.ok) throw new Error('El servidor respondió ' + resp.status);
    const j = await resp.json();
    if (!j.ok) {
      const err = new Error(j.error || 'Error desconocido');
      err.codigo = j.codigo;
      throw err;
    }
    return j.datos;
  }

  async function cargar(accion, datos, mensajeOk) {
    if (estado.cargando) return;
    estado.cargando = true;
    $('#btn-refrescar').classList.add('girando');
    $('#estado-sync').textContent = 'Sincronizando…';
    try {
      const r = await api(accion || 'resumen', datos);
      estado.datos = r;
      estado.deCache = false;
      guardarLS(CLAVE_CACHE, { guardado: new Date().toISOString(), datos: r });
      $('#aviso-offline').hidden = true;
      pintar();
      if (mensajeOk) toast(mensajeOk);
      return r;
    } catch (e) {
      if (e.codigo === 'NO_AUTORIZADO') {
        toast('Código de acceso incorrecto. Revísalo en Ajustes.');
      } else if (!accion || accion === 'resumen') {
        const c = leerLS(CLAVE_CACHE);
        if (c && c.datos && !estado.datos) { estado.datos = c.datos; estado.deCache = true; pintar(); }
        const banda = $('#aviso-offline');
        banda.hidden = false;
        banda.textContent = 'No se ha podido conectar (' + e.message + '). ' +
          (estado.datos ? 'Se muestran los últimos datos guardados' + (c ? ' (' + fmtFechaHora(c.guardado) + ')' : '') + '.' : '');
      }
      throw e;
    } finally {
      estado.cargando = false;
      $('#btn-refrescar').classList.remove('girando');
      actualizarSync();
    }
  }

  function actualizarSync() {
    const c = leerLS(CLAVE_CACHE);
    $('#estado-sync').textContent = c ? (estado.deCache ? 'Sin conexión · ' : 'Actualizado ') + fmtFechaHora(c.guardado) : '—';
  }

  /* ---------------- Navegación ---------------- */
  function irA(vista) {
    estado.vista = vista;
    document.querySelectorAll('.navegacion button').forEach(b => {
      if (b.dataset.vista === vista) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#titulo-pantalla').textContent = TITULOS[vista];
    document.querySelectorAll('.vista').forEach(v => { v.hidden = true; });
    $('#v-' + vista).hidden = false;
    pintar();
    window.scrollTo({ top: 0 });
    try { history.replaceState(null, '', '#' + vista); } catch (e) {}
  }

  function pintar() {
    if (!estado.datos) return;
    Object.values(estado.graficos).forEach(g => { try { g.destroy(); } catch (e) {} });
    estado.graficos = {};
    const f = { patrimonio: vistaPatrimonio, oro: vistaOro, fondos: vistaFondos, cartera: vistaCartera, informes: vistaInformes }[estado.vista];
    f($('#v-' + estado.vista), estado.datos);
  }

  /* ---------------- Bloques comunes ---------------- */
  function bloqueProximamente(titulo, fase, texto) {
    return `<article class="tarjeta proximamente"><h2>${esc(titulo)} <span class="fase">${esc(fase)}</span></h2><p class="suave">${esc(texto)}</p></article>`;
  }

  function tarjetaIndicadores(titulo, ids, d, nota) {
    const lista = d.mercado.filter(m => !ids || ids.indexOf(m.id) >= 0);
    const html = lista.map(m => {
      const ok = String(m.estado || '').indexOf('OK') === 0 && m.valor !== null && m.valor !== undefined;
      if (!ok) {
        return `<div class="ind no-disp"><div class="nombre">${esc(m.indicador)}</div>
          <div class="valor">Dato no disponible</div><div class="meta">${esc(String(m.estado || '').replace('NO DISPONIBLE: ', ''))}</div></div>`;
      }
      const var_ = m.variacion;
      const txtVar = var_ === null || var_ === undefined ? '' :
        (m.tipo_variacion === 'pct' ? fmtPct(var_, 2, true) : (var_ > 0 ? '+' : '') + fmtNum(var_, 2) + ' p.p.');
      const valor = m.unidad === '%' ? fmtNum(m.valor, m.decimales) + ' %' : fmtNum(m.valor, m.decimales) + (m.unidad === 'índice' ? '' : ' ' + esc(m.unidad));
      const antiguo = String(m.estado).indexOf('último dato válido') > 0 ? ' · ⚠ actualización fallida' : '';
      return `<div class="ind"><div class="nombre">${esc(m.indicador)}</div>
        <div class="valor num">${valor} <small class="${clase(var_)}" style="font-size:.75rem">${txtVar}</small></div>
        <div class="meta">Dato del ${fmtFecha(m.fecha_dato)} · <a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.fuente)}</a><br>Consultado ${fmtFechaHora(m.actualizado)}${antiguo}</div></div>`;
    }).join('');
    return `<article class="tarjeta ancho"><h2>${esc(titulo)}</h2>${nota ? `<p class="suave">${esc(nota)}</p>` : ''}
      <div class="indicadores">${html}</div>
      <p class="suave" style="margin-top:10px">La variación compara con el dato anterior publicado por la fuente (día, mes o sesión, según el indicador).</p></article>`;
  }

  function tarjetaDonde(d, conTitulo) {
    const p = d.propuesta;
    const importe = p ? p.importe : (Number(d.config.aportacion_mensual) || 0);
    return `<article class="tarjeta donde ancho" id="tarjeta-donde">
      ${conTitulo ? '' : ''}
      <form class="pregunta" id="form-donde">
        <label for="importe-donde">¿Dónde invierto mis próximos</label>
        <input id="importe-donde" type="number" inputmode="decimal" min="1" step="1" value="${esc(Math.round(importe))}">
        <span>€?</span>
        <button class="btn primario pequeno" type="submit">Calcular</button>
      </form>
      <div id="resultado-donde">${htmlReparto(p)}</div>
    </article>`;
  }

  function htmlReparto(p) {
    if (!p || !p.reparto) return '';
    if (!p.reparto.length) return `<p class="suave">${esc(p.explicacion || '')}</p>`;
    return `<p class="suave">${esc(p.explicacion)}</p><ul class="reparto">${p.reparto.map(r => `
      <li><span class="punto" style="background:${esc(r.color)}"></span>
      <div>${esc(r.nombre)}<small>${r.productos && r.productos.length ? 'En tu cartera: ' + r.productos.map(esc).join(', ') : 'Aún no tienes ningún producto en esta categoría'}</small></div>
      <strong class="num">${fmtEur(r.importe, 0)}</strong></li>`).join('')}</ul>
      <p class="suave" style="margin-top:8px">Propuesta matemática para acercarte a tus pesos objetivo, sin vender nada. No tiene en cuenta todavía la situación de los mercados: eso lo añadirá el semáforo (Fase 4).</p>`;
  }

  function enlazarDonde() {
    const f = $('#form-donde');
    if (!f) return;
    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const imp = parseFloat($('#importe-donde').value);
      if (!(imp > 0)) { toast('Indica un importe mayor que cero.'); return; }
      const cont = $('#resultado-donde');
      cont.innerHTML = '<div class="esqueleto" style="height:80px"></div>';
      try {
        const p = await api('propuestaAportacion', { importe: imp });
        cont.innerHTML = htmlReparto(p);
      } catch (e) {
        cont.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      }
    });
  }

  function barrasCategorias(cats, umbral) {
    return `<div class="barras">${cats.map(c => `
      <div class="barra-fila">
        <div class="cab"><span>${esc(c.nombre)}</span>
          <span class="num">${fmtPct(c.actual, 1)} <span class="suave">/ ${fmtPct(c.objetivo, 0)}</span>
          ${c.fuera_de_rango ? `<span class="chip alerta">${c.desviacion > 0 ? '+' : ''}${fmtNum(c.desviacion, 1)} p.p.</span>` : ''}</span></div>
        <div class="barra" role="img" aria-label="${esc(c.nombre)}: ${fmtNum(c.actual, 1)} % frente a objetivo ${fmtNum(c.objetivo, 0)} %">
          <div class="relleno" style="width:${Math.min(100, c.actual)}%;background:${esc(c.color)}"></div>
          <span class="marca-obj" style="left:calc(${Math.min(100, c.objetivo)}% - 1px)"></span>
        </div>
      </div>`).join('')}</div>
      <p class="suave" style="margin-top:10px">La línea vertical marca el peso objetivo. Se avisa cuando la desviación supera ±${esc(umbral)} puntos.</p>`;
  }

  /* ---------------- Gráficos ---------------- */
  function colorVar(nombre) { return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim(); }

  function graficoDona(id, cats) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="vacio">El gráfico no ha podido cargarse (sin conexión). Vuelve a intentarlo con conexión.</p>'; return; }
    const datos = cats.filter(c => c.valor > 0);
    estado.graficos[id] = new Chart(el, {
      type: 'doughnut',
      data: { labels: datos.map(c => c.nombre), datasets: [{ data: datos.map(c => c.valor), backgroundColor: datos.map(c => c.color), borderColor: colorVar('--superficie'), borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '64%',
        plugins: {
          legend: { position: 'bottom', labels: { color: colorVar('--texto-2'), boxWidth: 10, padding: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ' ' + ctx.label + ': ' + fmtEur(ctx.raw, 0) } }
        }
      }
    });
  }

  function graficoEvolucion(id, historico) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="vacio">El gráfico no ha podido cargarse (sin conexión). Vuelve a intentarlo con conexión.</p>'; return; }
    estado.graficos[id] = new Chart(el, {
      type: 'line',
      data: {
        labels: historico.map(h => fmtFecha(h.fecha)),
        datasets: [
          { label: 'Patrimonio', data: historico.map(h => h.patrimonio), borderColor: colorVar('--acento'), backgroundColor: 'transparent', tension: .25, pointRadius: historico.length > 40 ? 0 : 2, borderWidth: 2.5 },
          { label: 'Dinero aportado (neto)', data: historico.map(h => h.invertido_neto), borderColor: colorVar('--texto-3'), borderDash: [5, 4], backgroundColor: 'transparent', pointRadius: 0, borderWidth: 1.5 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: colorVar('--texto-3'), maxTicksLimit: 6, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: colorVar('--texto-3'), font: { size: 11 }, callback: v => fmtEur(v, 0) }, grid: { color: colorVar('--borde') } }
        },
        plugins: {
          legend: { labels: { color: colorVar('--texto-2'), boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: ctx => ' ' + ctx.dataset.label + ': ' + fmtEur(ctx.raw, 0) } }
        }
      }
    });
  }

  /* ================= PANTALLA 1 · MI PATRIMONIO ================= */
  function vistaPatrimonio(el, d) {
    const c = d.cartera;
    const vacia = c.numero_operaciones === 0;
    const avisosPerfil = (d.perfil || []).map(a => `<div class="aviso">${esc(a)}</div>`).join('');
    const avisosPrecio = [];
    if (c.avisos.sin_precio.length) avisosPrecio.push(`<div class="aviso">Sin precio actual: ${c.avisos.sin_precio.map(esc).join(', ')}. No se incluyen en el total hasta que indiques su precio.</div>`);
    if (c.avisos.precios_antiguos.length) avisosPrecio.push(`<div class="aviso info">Precios con más de 7 días: ${c.avisos.precios_antiguos.map(p => esc(p.nombre) + ' (' + p.dias + ' d)').join(', ')}. Actualízalos en «Mi cartera». La actualización automática llegará en la Fase 3.</div>`);

    el.innerHTML = `
      <article class="tarjeta heroe ancho">
        <p class="etiqueta">Patrimonio total</p>
        <p class="cifra num">${fmtEur(c.total)}</p>
        ${vacia ? '<p class="suave">Todavía no has registrado inversiones. Empieza en «Mi cartera».</p>' : `
        <div class="fila-datos">
          <div class="dato"><small>Ganancia total</small><strong class="num ${clase(c.ganancia_total)}">${fmtEur(c.ganancia_total)}</strong></div>
          <div class="dato"><small>Rentabilidad acumulada</small><strong class="num ${clase(c.rentabilidad_acumulada)}">${fmtPct(c.rentabilidad_acumulada, 2, true)}</strong></div>
          <div class="dato"><small>Rentabilidad anualizada</small><strong class="num ${clase(c.rentabilidad_anualizada)}">${c.rentabilidad_anualizada === null ? 'Aún no' : fmtPct(c.rentabilidad_anualizada, 2, true)}</strong></div>
          <div class="dato"><small>Dinero aportado (neto)</small><strong class="num">${fmtEur(c.invertido_neto)}</strong></div>
        </div>
        ${c.rentabilidad_anualizada === null && c.aviso_anualizada ? `<p class="suave" style="margin-top:8px;font-size:.78rem">Rentabilidad anualizada: ${esc(c.aviso_anualizada)}</p>` : ''}`}
      </article>

      ${avisosPerfil || avisosPrecio.length ? `<article class="tarjeta ancho"><h2>Para tener en cuenta</h2>${avisosPerfil}${avisosPrecio.join('')}</article>` : ''}

      ${tarjetaDonde(d)}

      ${bloqueProximamente('Semáforo de oportunidades', 'Fase 4', 'Indicará de un vistazo si el oro y los fondos indexados están en situación favorable, neutral o desfavorable para invertir, combinando análisis fundamental, técnico y macroeconómico con datos reales. No se muestra nada hasta que el motor de análisis esté conectado.')}

      <article class="tarjeta">
        <h2>Evolución del patrimonio</h2>
        ${d.historico.length >= 2 ? '<div class="grafico"><canvas id="g-evolucion" aria-label="Evolución del patrimonio"></canvas></div>' :
          '<p class="vacio">La app guarda una foto de tu patrimonio cada noche. El gráfico aparecerá cuando haya al menos dos días registrados.</p>'}
      </article>

      <article class="tarjeta">
        <h2>Distribución de la cartera</h2>
        ${c.total > 0 ? '<div class="grafico dona"><canvas id="g-dona" aria-label="Distribución por categoría"></canvas></div>' : '<p class="vacio">Sin posiciones valoradas.</p>'}
      </article>

      <article class="tarjeta ancho">
        <h2>Tu cartera frente al objetivo</h2>
        ${c.total > 0 ? barrasCategorias(c.categorias, d.catalogos.umbral) : '<p class="vacio">Cuando registres tus inversiones verás aquí cuánto te separa de tu cartera objetivo.</p>'}
      </article>

      ${tarjetaMercadosHoy(d)}

      ${tarjetaIndicadores('Situación general de los mercados', ['EURUSD', 'BCE_DEPO', 'FED_TIPO', 'IPCA_EZ', 'IPCA_ES', 'BONO10_EZ', 'BONO10_US'], d)}

      ${bloqueProximamente('Oportunidades y alertas', 'Fases 4 y 6', 'Aquí aparecerán las oportunidades detectadas y las alertas importantes, que también recibirás por correo y Telegram.')}
    `;
    if (d.historico.length >= 2) graficoEvolucion('g-evolucion', d.historico);
    if (c.total > 0) graficoDona('g-dona', c.categorias);
    enlazarDonde();
  }

  /* ================= Bloques de precios (Fase 3) ================= */
  const fmtVar = (n, dec) => {
    if (n === null || n === undefined || isNaN(n)) return '<span class="suave">—</span>';
    const dd = dec === undefined ? 2 : dec;
    if (Math.abs(n) < 0.5 * Math.pow(10, -dd)) n = 0;
    return `<span class="${clase(n)}">${fmtPct(n, dd, true)}</span>`;
  };

  function avisoPrecios(pr) {
    if (!pr) return '';
    if (!pr.configurado) return `<div class="aviso">Los precios automáticos no están activados: falta la clave de EODHD en el servidor (Fase 3, paso 2).</div>`;
    return '';
  }

  function piePrecios(pr) {
    return `<p class="suave" style="margin-top:8px">Fuente: <a href="${esc(pr.fuente_url)}" target="_blank" rel="noopener">${esc(pr.proveedor)}</a> · última actualización ${fmtFechaHora(pr.ultima_ejecucion)} · llamadas hoy ${esc(pr.llamadas_hoy)}/${esc(pr.limite_diario)}. Son precios de cierre del día, no en tiempo real.</p>`;
  }

  function tarjetaMercadosHoy(d) {
    const pr = d.precios;
    if (!pr) return '';
    const sel = ['GSPC.INDX', 'STOXX50E.INDX', 'EUNL.XETRA', 'IS3N.XETRA'];
    const filas = [];
    if (pr.oro && pr.oro.eur) {
      filas.push(`<div class="ind"><div class="nombre">Oro (onza, en euros)</div><div class="valor num">${fmtEur(pr.oro.eur.cierre, 0)} <small style="font-size:.75rem">${fmtVar(pr.oro.eur.var_1d)}</small></div><div class="meta">Cierre del ${fmtFecha(pr.oro.eur.fecha)} · 1 año: ${fmtVar(pr.oro.eur.var_1a, 1)}</div></div>`);
    }
    pr.referencias.filter(r => sel.indexOf(r.simbolo) >= 0).forEach(r => {
      const m = r.metricas;
      filas.push(m ? `<div class="ind"><div class="nombre">${esc(r.nombre)}</div><div class="valor num">${fmtNum(m.cierre, 2)} <small style="font-size:.75rem">${fmtVar(m.var_1d)}</small></div><div class="meta">Cierre del ${fmtFecha(m.fecha)} · 1 año: ${fmtVar(m.var_1a, 1)}</div></div>`
        : `<div class="ind no-disp"><div class="nombre">${esc(r.nombre)}</div><div class="valor">Dato no disponible</div><div class="meta">${esc(String(r.estado).replace('NO DISPONIBLE: ', ''))}</div></div>`);
    });
    return `<article class="tarjeta ancho"><h2>Mercados hoy</h2>${avisoPrecios(pr)}<div class="indicadores">${filas.join('')}</div>${pr.configurado ? piePrecios(pr) : ''}</article>`;
  }

  function graficoLinea(id, serie, etiqueta, fmt) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.Chart) { el.parentNode.innerHTML = '<p class="vacio">El gráfico no ha podido cargarse (sin conexión).</p>'; return; }
    estado.graficos[id] = new Chart(el, {
      type: 'line',
      data: { labels: serie.map(p => fmtFecha(p[0])), datasets: [{ label: etiqueta, data: serie.map(p => p[1]), borderColor: colorVar('--acento'), backgroundColor: 'transparent', pointRadius: 0, borderWidth: 2, tension: .15 }] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { color: colorVar('--texto-3'), maxTicksLimit: 5, font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: colorVar('--texto-3'), font: { size: 11 }, callback: v => fmt(v) }, grid: { color: colorVar('--borde') } }
        },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + fmt(ctx.raw) } } }
      }
    });
  }

  function tablaVariaciones(filas) {
    return `<div class="tabla-scroll"><table><thead><tr><th></th><th class="der">Cierre</th><th class="der">1 día</th><th class="der">1 sem.</th><th class="der">1 mes</th><th class="der">Este año</th><th class="der">1 año</th><th class="der">Desde máx.*</th></tr></thead><tbody>
      ${filas.map(f => f.m ? `<tr><td>${esc(f.nombre)}</td><td class="der num">${f.fmt(f.m.cierre)}</td><td class="der num">${fmtVar(f.m.var_1d)}</td><td class="der num">${fmtVar(f.m.var_1s)}</td><td class="der num">${fmtVar(f.m.var_1m)}</td><td class="der num">${fmtVar(f.m.var_anio)}</td><td class="der num">${fmtVar(f.m.var_1a)}</td><td class="der num">${fmtVar(f.m.desde_maximo, 1)}</td></tr>`
        : `<tr><td>${esc(f.nombre)}</td><td colspan="7" class="suave">${esc(String(f.estado || 'Dato no disponible').replace('NO DISPONIBLE: ', 'No disponible: '))}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  /* ================= PANTALLA 2 · ORO ================= */
  function vistaOro(el, d) {
    const pos = d.cartera.categorias.find(c => c.id === 'ORO');
    const pr = d.precios || {};
    const oro = pr.oro;
    const w = d.wgc;
    const monedaOro = estado.monedaOro || 'eur';
    let precioHtml;
    if (oro && oro.usd && oro.eur) {
      const m = monedaOro === 'eur' ? oro.eur : oro.usd;
      const fmt = monedaOro === 'eur' ? (v => fmtEur(v, 0)) : (v => fmtNum(v, 0) + ' $');
      precioHtml = `<article class="tarjeta ancho">
        <h2>Precio del oro <span class="botonera"><button class="btn pequeno ${monedaOro === 'eur' ? 'primario' : ''}" data-moneda="eur">€</button><button class="btn pequeno ${monedaOro === 'usd' ? 'primario' : ''}" data-moneda="usd">$</button></span></h2>
        <p class="num" style="font-size:2rem;font-weight:750;margin:0">${fmt(m.cierre)} <small style="font-size:1rem">por onza</small></p>
        <p class="suave">Cierre del ${fmtFecha(m.fecha)} · ${monedaOro === 'eur' ? 'en euros (calculado con el cambio euro/dólar del mismo día)' : 'en dólares'} · ${fmtEur(oro.eur.cierre / 31.1035, 2)} por gramo</p>
        <div class="indicadores compacto" style="margin:10px 0">
          <div class="ind"><div class="nombre">1 día</div><div class="valor num">${fmtVar(m.var_1d)}</div></div>
          <div class="ind"><div class="nombre">1 semana</div><div class="valor num">${fmtVar(m.var_1s)}</div></div>
          <div class="ind"><div class="nombre">1 mes</div><div class="valor num">${fmtVar(m.var_1m)}</div></div>
          <div class="ind"><div class="nombre">1 año</div><div class="valor num">${fmtVar(m.var_1a, 1)}</div></div>
          <div class="ind"><div class="nombre">Desde el máximo*</div><div class="valor num">${fmtVar(m.desde_maximo, 1)}</div><div class="meta">Máx. ${fmt(m.maximo)} el ${fmtFecha(m.fecha_maximo)}</div></div>
        </div>
        <div class="grafico"><canvas id="g-oro" aria-label="Evolución del precio del oro"></canvas></div>
        <p class="suave">* Máximo dentro del historial disponible (desde ${fmtFecha(m.historial_desde)}). Con el plan gratuito de datos es 1 año; con el plan Historian, más de 30.</p>
        ${piePrecios(pr)}
      </article>`;
    } else {
      precioHtml = `<article class="tarjeta ancho"><h2>Precio del oro</h2>${avisoPrecios(pr)}<p class="vacio">Precio no disponible todavía. Se descargará en la próxima actualización de precios (08:00 y 21:00) o pulsando «Actualizar precios ahora» en Ajustes.</p></article>`;
    }

    const u = w && w.filas.length ? w.filas[w.filas.length - 1] : null;
    const wgcHtml = `<article class="tarjeta ancho">
      <h2>Demanda mundial, bancos centrales y ETF <span class="fase" style="background:var(--superficie-2);color:var(--texto-3)">trimestral</span></h2>
      ${w && w.pendiente ? `<div class="aviso"><span>Ya está publicado el informe del World Gold Council de <strong>${esc(w.esperado)}</strong> y aún no lo has cargado. ${u ? 'Último cargado: ' + esc(u.trimestre) + '.' : ''}</span></div>` : ''}
      ${u ? `<div class="indicadores" style="margin-top:10px">
        <div class="ind"><div class="nombre">Demanda total</div><div class="valor num">${fmtNum(u.demanda_total_t, 0)} t</div></div>
        <div class="ind"><div class="nombre">Compras netas de bancos centrales</div><div class="valor num">${fmtNum(u.bancos_centrales_t, 0)} t</div></div>
        <div class="ind"><div class="nombre">Flujos de ETF de oro</div><div class="valor num ${clase(u.etf_flujos_t)}">${u.etf_flujos_t > 0 ? '+' : ''}${fmtNum(u.etf_flujos_t, 0)} t</div></div>
        <div class="ind"><div class="nombre">Oferta total</div><div class="valor num">${fmtNum(u.oferta_total_t, 0)} t</div></div>
      </div>
      <p class="suave">Trimestre ${esc(u.trimestre)} · Fuente: <a href="${esc(w.url)}" target="_blank" rel="noopener">World Gold Council · Gold Demand Trends</a> · cargado ${fmtFechaHora(u.cargado)}</p>
      ${w.filas.length > 1 ? `<div class="tabla-scroll"><table><thead><tr><th>Trimestre</th><th class="der">Demanda</th><th class="der">Bancos centrales</th><th class="der">ETF</th><th class="der">Oferta</th></tr></thead><tbody>${w.filas.slice().reverse().map(f => `<tr><td>${esc(f.trimestre)}</td><td class="der num">${fmtNum(f.demanda_total_t, 0)}</td><td class="der num">${fmtNum(f.bancos_centrales_t, 0)}</td><td class="der num">${fmtNum(f.etf_flujos_t, 0)}</td><td class="der num">${fmtNum(f.oferta_total_t, 0)}</td></tr>`).join('')}</tbody></table></div>` : ''}`
      : '<p class="vacio">Aún no hay datos del World Gold Council. Cárgalos con el botón de abajo.</p>'}
      <div class="botonera" style="margin-top:10px"><button class="btn primario" data-accion="wgc">Cargar datos del trimestre</button>
      <a class="btn" href="${esc(w ? w.url : '#')}" target="_blank" rel="noopener">Abrir informe del WGC</a></div>
      <p class="suave">Te enviaremos un correo cada trimestre cuando toque actualizarlos.</p>
    </article>`;

    el.innerHTML = `
      ${precioHtml}
      <article class="tarjeta">
        <h2>Tu posición en oro</h2>
        <p class="num" style="font-size:1.6rem;font-weight:700;margin:0">${fmtEur(pos ? pos.valor : 0)}</p>
        <p class="suave">${pos ? fmtPct(pos.actual, 1) + ' de tu cartera · objetivo ' + fmtPct(pos.objetivo, 0) : ''}</p>
      </article>
      ${bloqueProximamente('Puntuación de oportunidad y recomendación', 'Fase 4', 'Puntuación de 0 a 100 y semáforo, combinando el análisis técnico de este precio, los datos del WGC y los factores macro de abajo.')}
      ${wgcHtml}
      ${tarjetaIndicadores('Factores que mueven el oro (datos oficiales)', ['TIPO_REAL_US', 'DOLAR_INDICE', 'EURUSD', 'INFL_ESPERADA_US', 'IPC_US', 'FED_TIPO'], d,
        'Normalmente, unos tipos de interés reales más bajos y un dólar más débil favorecen al oro. Son relaciones históricas, no reglas fijas.')}
    `;
    if (oro && oro.usd && oro.eur) {
      const eur = monedaOro === 'eur';
      graficoLinea('g-oro', eur ? oro.grafico_eur : oro.grafico_usd, 'Oro', eur ? (v => fmtEur(v, 0)) : (v => fmtNum(v, 0) + ' $'));
    }
    el.onclick = ev => {
      const m = ev.target.closest('[data-moneda]');
      if (m) { estado.monedaOro = m.dataset.moneda; pintar(); return; }
      if (ev.target.closest('[data-accion="wgc"]')) modalWGC(w);
    };
  }

  function modalWGC(w) {
    abrirModal('Datos del World Gold Council', `
      <form class="formulario" id="f-wgc">
        <p class="suave">Copia las cifras del resumen del informe trimestral <em>Gold Demand Trends</em>. Todas en <strong>toneladas</strong>.</p>
        <div class="doble">
          <label>Trimestre<input name="trimestre" required pattern="\\d{4}-[Tt][1-4]" value="${esc(w ? w.esperado : '')}" placeholder="2026-T3"></label>
          <label>Fecha de publicación<input name="fecha_publicacion" type="date" max="${hoyISO()}"></label>
        </div>
        <div class="doble">
          <label>Demanda total (t)<input name="demanda_total_t" type="number" step="any" inputmode="decimal" required></label>
          <label>Oferta total (t)<input name="oferta_total_t" type="number" step="any" inputmode="decimal" required></label>
        </div>
        <div class="doble">
          <label>Bancos centrales, compras netas (t)<input name="bancos_centrales_t" type="number" step="any" inputmode="decimal" required>
            <span class="ayuda">Si vendieron más de lo que compraron, en negativo.</span></label>
          <label>Flujos de ETF de oro (t)<input name="etf_flujos_t" type="number" step="any" inputmode="decimal" required>
            <span class="ayuda">Entradas en positivo, salidas en negativo.</span></label>
        </div>
        <label>Precio medio del trimestre (USD/onza) <span class="ayuda">(opcional)</span><input name="precio_medio_usd" type="number" step="any" inputmode="decimal"></label>
        <label>Notas <span class="ayuda">(opcional)</span><input name="notas" maxlength="300"></label>
        <p class="error" role="alert"></p>
        <div class="botonera"><button class="btn primario" type="submit">Guardar</button>
          <a class="btn" href="${esc(w ? w.url : '#')}" target="_blank" rel="noopener">Abrir informe</a></div>
      </form>`, cuerpo => {
      const f = $('#f-wgc', cuerpo);
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        const d = Object.fromEntries(new FormData(f).entries());
        d.trimestre = String(d.trimestre).toUpperCase();
        enviarFormulario(f, 'guardarWGC', d, 'Datos del oro guardados');
      });
    });
  }

  /* ================= PANTALLA 3 · FONDOS ================= */
  const NOMBRE_CAT = { RV_DES: 'Renta variable desarrollados / global', RV_EME: 'Renta variable emergentes', ORO: 'Oro', BONOS: 'Bonos gubernamentales', REITS: 'REITs (inmobiliario)', LIQUIDEZ: 'Liquidez' };

  function vistaFondos(el, d) {
    const rv = d.cartera.categorias.filter(c => c.id === 'RV_DES' || c.id === 'RV_EME');
    const pr = d.precios || { referencias: [], graficos: {} };
    const indices = pr.referencias.filter(r => r.grupo === 'indice');
    const selIdx = estado.indiceSel && pr.graficos[estado.indiceSel] ? estado.indiceSel : (Object.keys(pr.graficos)[0] || '');
    const cat = d.catalogo || { productos: [], notas: [] };
    const tengo = isin => d.cartera.posiciones.some(p => p.isin && p.isin === isin);

    const grupos = Object.keys(NOMBRE_CAT).map(k => {
      const prods = cat.productos.filter(p => p.categoria === k);
      if (!prods.length) return '';
      return `<h3 style="margin:16px 0 8px">${esc(NOMBRE_CAT[k])}</h3><div class="posiciones">${prods.map(p => `
        <div class="posicion">
          <div class="arriba"><div><div class="nombre">${esc(p.nombre)}</div>
            <span class="etiqueta-cat">${p.isin ? esc(p.isin) + ' · ' : ''}${esc(p.tipo)} · ${esc(p.domicilio)}</span></div>
            <div class="valor num">${p.isin ? 'TER ' + fmtNum(p.ter, 2) + ' %' : ''}</div></div>
          <div class="detalles">
            <span>Política<b>${esc(p.politica)}</b></span><span>Réplica<b>${esc(p.replicacion)}</b></span><span>Tamaño<b>${esc(p.tamano)}</b></span>${p.ticker ? `<span>Ticker<b>${esc(p.ticker)}</b></span>` : ''}
          </div>
          <div style="font-size:.86rem"><span class="pos">✓</span> ${p.pros.map(esc).join('<br><span class="pos">✓</span> ')}</div>
          <div style="font-size:.86rem"><span class="neg">!</span> ${p.contras.map(esc).join('<br><span class="neg">!</span> ')}</div>
          <div class="botonera">
            ${p.isin ? (tengo(p.isin) ? '<span class="chip ok">Ya está en tu cartera</span>' : `<button class="btn pequeno" data-alta="${esc(p.isin)}">Añadir a mi cartera</button>`) : ''}
            ${p.fuente ? `<a class="btn pequeno" href="${esc(p.fuente)}" target="_blank" rel="noopener">Ficha</a>` : ''}
          </div>
        </div>`).join('')}</div>`;
    }).join('');

    el.innerHTML = `
      <article class="tarjeta ancho">
        <h2>Evolución de los índices</h2>
        ${avisoPrecios(pr)}
        ${tablaVariaciones(indices.map(r => ({ nombre: r.nombre, m: r.metricas, estado: r.estado, fmt: v => r.unidad === '€' ? fmtEur(v, 2) : fmtNum(v, 0) })))}
        <p class="suave">* Caída desde el máximo dentro del historial disponible. MSCI World y Emergentes se siguen a través del precio de su ETF (los índices de MSCI requieren licencia).</p>
        ${selIdx ? `<div class="botonera" style="margin:10px 0">${Object.keys(pr.graficos).map(s => `<button class="btn pequeno ${s === selIdx ? 'primario' : ''}" data-indice="${esc(s)}">${esc((indices.find(r => r.simbolo === s) || {}).nombre || s).replace(/ \(.*\)/, '')}</button>`).join('')}</div>
        <div class="grafico"><canvas id="g-indice" aria-label="Evolución del índice"></canvas></div>` : ''}
        ${pr.configurado ? piePrecios(pr) : ''}
      </article>
      <article class="tarjeta">
        <h2>Tu renta variable</h2>
        ${rv.map(c => `<p style="margin:.2rem 0">${esc(c.nombre)}: <strong class="num">${fmtEur(c.valor, 0)}</strong> <span class="suave">(${fmtPct(c.actual, 1)} · objetivo ${fmtPct(c.objetivo, 0)})</span></p>`).join('')}
      </article>
      ${bloqueProximamente('Valoraciones y recomendación individualizada', 'Fase 4', 'Tendencia, medias móviles, RSI y otros indicadores sobre estos precios, más valoración (PER/CAPE) cuando esté disponible, para cada índice y producto.')}
      <article class="tarjeta ancho">
        <h2>Comparador de productos</h2>
        <p class="suave">Candidatos para cada categoría de tu cartera, con datos verificados el ${fmtFecha(cat.verificado)}. Antes de comprar, busca el ISIN en Trade Republic para confirmar que está disponible y si admite plan de inversión. Es información para comparar, no una recomendación personalizada.</p>
        ${grupos}
        <h3 style="margin:16px 0 8px">Fiscalidad en España (resumen)</h3>
        ${cat.notas.map(n => `<div class="aviso info">${esc(n)}</div>`).join('')}
      </article>
      ${tarjetaIndicadores('Entorno de tipos de interés y bonos', ['BCE_DEPO', 'FED_TIPO', 'BONO10_EZ', 'BONO10_US', 'IPCA_EZ'], d,
        'Los tipos de interés influyen en la valoración de las bolsas y en el precio de los bonos que ya tienes.')}
    `;
    if (selIdx) {
      const r = indices.find(x => x.simbolo === selIdx) || {};
      graficoLinea('g-indice', pr.graficos[selIdx], r.nombre || selIdx, v => r.unidad === '€' ? fmtEur(v, 2) : fmtNum(v, 0));
    }
    el.onclick = ev => {
      const b = ev.target.closest('[data-indice]');
      if (b) { estado.indiceSel = b.dataset.indice; pintar(); return; }
      const a = ev.target.closest('[data-alta]');
      if (a) {
        const p = cat.productos.find(x => x.isin === a.dataset.alta);
        modalActivo(null, { nombre: p.nombre, isin: p.isin, ticker: p.ticker, categoria: p.categoria, tipo: p.tipo, region: p.region, divisa: p.divisa });
      }
    };
  }

  /* ================= PANTALLA 4 · MI CARTERA ================= */
  function vistaCartera(el, d) {
    const c = d.cartera;
    const nombreCat = id => (d.catalogos.categorias.find(x => x.id === id) || {}).nombre || id;
    const colorCat = id => (d.catalogos.categorias.find(x => x.id === id) || {}).color || '#999';
    const activos = c.posiciones;
    const nombreActivo = id => (activos.find(a => a.id === id) || {}).nombre || '¿?';

    const posHtml = activos.length ? activos.map(p => {
      const liq = p.categoria === 'LIQUIDEZ';
      return `<div class="posicion">
        <div class="arriba">
          <div><div class="nombre">${esc(p.nombre)}</div>
            <span class="etiqueta-cat"><i style="background:${esc(colorCat(p.categoria))}"></i>${esc(nombreCat(p.categoria))} · ${esc(p.tipo)}${p.isin ? ' · ' + esc(p.isin) : ''}</span></div>
          <div class="valor num">${p.sin_precio ? '<span class="suave">Sin precio</span>' : fmtEur(p.valor)}
            ${!liq && p.latente !== null && p.participaciones > 0 ? `<div class="${clase(p.latente)}" style="font-size:.82rem">${fmtEur(p.latente)} (${fmtPct(p.latente_pct, 1, true)})</div>` : ''}</div>
        </div>
        <div class="detalles">
          ${liq ? `<span>Saldo<b class="num">${fmtEur(p.participaciones)}</b></span>` : `
          <span>Participaciones<b class="num">${fmtNum(p.participaciones, 4)}</b></span>
          <span>Precio medio<b class="num">${fmtEur(p.precio_medio, 4)}</b></span>
          <span>Precio actual<b class="num">${p.precio_actual ? fmtEur(p.precio_actual, 4) : '—'}</b></span>
          <span>Fecha precio<b>${fmtFecha(p.fecha_precio)}</b></span>`}
          <span>Peso<b class="num">${fmtPct(p.peso, 1)}</b></span>
          <span>Comisiones<b class="num">${fmtEur(p.comisiones)}</b></span>
          ${p.realizado ? `<span>Ganancia realizada<b class="num ${clase(p.realizado)}">${fmtEur(p.realizado)}</b></span>` : ''}
          ${p.rentas ? `<span>Dividendos/intereses<b class="num pos">${fmtEur(p.rentas)}</b></span>` : ''}
        </div>
        ${!liq && p.fuente_precio ? `<span class="suave">Precio: ${esc(p.fuente_precio)}</span>` : ''}
        <div class="botonera">
          ${liq ? '' : `<button class="btn pequeno" data-accion="precio" data-id="${esc(p.id)}">Actualizar precio</button>`}
          <button class="btn pequeno" data-accion="operar" data-id="${esc(p.id)}">Registrar operación</button>
          <button class="btn pequeno" data-accion="editar-activo" data-id="${esc(p.id)}">Editar</button>
        </div>
      </div>`;
    }).join('') : '<p class="vacio">Aún no tienes activos. Pulsa «Añadir activo» para dar de alta, por ejemplo, tu ETF de renta variable mundial o tu cuenta de Trade Republic.</p>';

    const reb = d.rebalanceo;
    const rebHtml = `<p>${esc(reb.mensaje)}</p>${reb.detalle && reb.detalle.length ? `<div class="tabla-scroll"><table>
      <thead><tr><th>Categoría</th><th class="der">Actual</th><th class="der">Objetivo</th><th class="der">Desfase</th><th class="der">Meses*</th></tr></thead>
      <tbody>${reb.detalle.map(x => `<tr><td>${esc(x.nombre)}</td><td class="der num">${fmtPct(x.actual, 1)}</td><td class="der num">${fmtPct(x.objetivo, 0)}</td>
        <td class="der num ${clase(-x.importe_desfase)}">${fmtEur(x.importe_desfase, 0)}</td><td class="der num">${x.meses_para_corregir || '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="suave">* Meses aproximados para corregir el déficit si toda la aportación mensual fuese a esa categoría. Un desfase positivo significa que sobra peso; negativo, que falta.</p>` : ''}`;

    const opsHtml = d.operaciones.length ? `<div class="tabla-scroll"><table>
      <thead><tr><th>Fecha</th><th>Activo</th><th>Tipo</th><th class="der">Partic.</th><th class="der">Precio</th><th class="der">Comisión</th><th class="der">Importe</th><th></th></tr></thead>
      <tbody>${d.operaciones.slice(0, 200).map(o => `<tr><td>${fmtFecha(o.fecha)}</td><td>${esc(nombreActivo(o.activo_id))}</td><td>${esc(o.tipo)}</td>
        <td class="der num">${o.tipo === 'RENTA' ? '—' : fmtNum(Number(o.participaciones), 4)}</td><td class="der num">${o.tipo === 'RENTA' ? '—' : fmtEur(Number(o.precio), 4)}</td>
        <td class="der num">${fmtEur(Number(o.comision))}</td><td class="der num">${fmtEur(Number(o.importe))}</td>
        <td><button class="btn pequeno peligro" data-accion="borrar-op" data-id="${esc(o.id)}" aria-label="Eliminar operación">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vacio">Sin operaciones registradas.</p>';

    el.innerHTML = `
      <article class="tarjeta ancho">
        <h2>Resumen</h2>
        <div class="indicadores">
          <div class="ind"><div class="nombre">Patrimonio</div><div class="valor num">${fmtEur(c.total)}</div></div>
          <div class="ind"><div class="nombre">Ganancia no realizada</div><div class="valor num ${clase(c.latente)}">${fmtEur(c.latente)}</div></div>
          <div class="ind"><div class="nombre">Ganancia realizada + rentas</div><div class="valor num ${clase(c.realizado + c.rentas)}">${fmtEur(c.realizado + c.rentas)}</div></div>
          <div class="ind"><div class="nombre">Comisiones soportadas</div><div class="valor num">${fmtEur(c.comisiones)}</div><div class="meta">${c.comisiones_pct === null ? '' : fmtPct(c.comisiones_pct, 2) + ' de lo invertido'}</div></div>
        </div>
        <div class="botonera" style="margin-top:12px">
          <button class="btn primario" data-accion="nuevo-activo">Añadir activo</button>
          <button class="btn" data-accion="operar" ${activos.length ? '' : 'disabled'}>Registrar operación</button>
          <button class="btn" data-accion="exportar">Exportar CSV</button>
        </div>
      </article>

      <article class="tarjeta ancho"><h2>Posiciones</h2><div class="posiciones">${posHtml}</div></article>

      ${tarjetaDonde(d)}

      <article class="tarjeta"><h2>Distribución y desviaciones</h2>${c.total > 0 ? barrasCategorias(c.categorias, d.catalogos.umbral) : '<p class="vacio">Sin posiciones valoradas.</p>'}</article>
      <article class="tarjeta"><h2>Rebalanceo anual</h2>${rebHtml}</article>

      <article class="tarjeta"><h2>Exposición por región</h2>${listaSimple(c.regiones)}</article>
      <article class="tarjeta"><h2>Exposición por divisa</h2>${listaSimple(c.divisas)}
        <p class="suave">Según la divisa de exposición que indicaste para cada producto. Un ETF mundial en euros sigue expuesto mayoritariamente al dólar.</p></article>

      <article class="tarjeta ancho"><h2>Operaciones</h2>${opsHtml}</article>
    `;
    enlazarDonde();
    el.onclick = ev => {
      const b = ev.target.closest('[data-accion]');
      if (!b) return;
      const id = b.dataset.id;
      switch (b.dataset.accion) {
        case 'nuevo-activo': modalActivo(null); break;
        case 'editar-activo': modalActivo(activos.find(a => a.id === id)); break;
        case 'operar': modalOperacion(id); break;
        case 'precio': modalPrecio(activos.find(a => a.id === id)); break;
        case 'borrar-op': borrarOperacion(id); break;
        case 'exportar': exportarCSV(); break;
      }
    };
  }

  function listaSimple(lista) {
    if (!lista || !lista.length) return '<p class="vacio">Sin datos.</p>';
    return `<div class="tabla-scroll"><table><tbody>${lista.map(r => `<tr><td>${esc(r.nombre)}</td><td class="der num">${fmtEur(r.valor, 0)}</td><td class="der num">${fmtPct(r.pct, 1)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  /* ================= PANTALLA 5 · ASESOR E INFORMES ================= */
  function vistaInformes(el) {
    el.innerHTML = `
      ${bloqueProximamente('Asesor financiero conversacional', 'Fase 8', 'Podrás preguntarle cualquier cosa («¿Es buen momento para comprar oro?», «¿Qué pasa si la bolsa cae un 20 %?») y te responderá con los datos reales de la app, citando fuentes y separando hechos, estimaciones y opiniones. Usará la API de Claude o de Gemini desde el servidor, nunca desde el móvil.')}
      ${bloqueProximamente('Informe diario y «Mi decisión de inversión de hoy»', 'Fase 7', 'Cada mañana recibirás por correo y Telegram un informe que responde a las 8 preguntas de la memoria del proyecto y termina con una recomendación clara (o con un «hoy no hay una oportunidad suficientemente justificada»).')}
      ${bloqueProximamente('Resumen semanal, informe mensual y perspectivas macro', 'Fase 7', 'Con historial de recomendaciones para comprobar después si acertaron.')}
      ${bloqueProximamente('Simulador de patrimonio a 15-20 años con Monte Carlo', 'Fase 5', 'Escenarios conservador, central y optimista, inflación, comisiones y crisis prolongadas.')}
      <article class="tarjeta ancho"><h2>Aviso importante</h2>
        <p class="suave">Esta aplicación es una herramienta informativa y analítica de uso personal. No es un asesor financiero regulado ni ejecuta operaciones. Las rentabilidades pasadas no garantizan rentabilidades futuras.</p></article>
    `;
  }

  /* ---------------- Modales ---------------- */
  function abrirModal(titulo, html, alAbrir) {
    const m = $('#modal');
    $('#modal-titulo').textContent = titulo;
    $('#modal-cuerpo').innerHTML = html;
    if (!m.open) m.showModal();
    if (alAbrir) alAbrir($('#modal-cuerpo'));
  }
  function cerrarModal() { const m = $('#modal'); if (m.open) m.close(); }

  async function enviarFormulario(form, accion, datos, okMsg) {
    const btn = form.querySelector('[type=submit]');
    const err = form.querySelector('.error');
    btn.disabled = true; err.textContent = '';
    try {
      await cargar(accion, datos, okMsg);
      cerrarModal();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  const opciones = (lista, sel, valorFn, textoFn) => lista.map(x => {
    const v = valorFn ? valorFn(x) : x; const t = textoFn ? textoFn(x) : x;
    return `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`;
  }).join('');

  function modalActivo(a, precarga) {
    const cat = estado.datos.catalogos;
    a = a || precarga || {};
    abrirModal(a.id ? 'Editar activo' : 'Añadir activo', `
      <form class="formulario" id="f-activo">
        <label>Nombre<input name="nombre" required maxlength="120" value="${esc(a.nombre)}" placeholder="p. ej. Vanguard FTSE All-World (Acc)"></label>
        <label>Categoría<select name="categoria" required>${opciones(cat.categorias, a.categoria, x => x.id, x => x.nombre)}</select></label>
        <div class="doble">
          <label>Tipo<select name="tipo">${opciones(cat.tipos, a.tipo || 'ETF')}</select></label>
          <label>Región<select name="region">${opciones(cat.regiones, a.region || 'Global')}</select></label>
        </div>
        <div class="doble">
          <label>ISIN <span class="ayuda">(opcional)</span><input name="isin" maxlength="12" value="${esc(a.isin)}" placeholder="IE00BK5BQT80" autocapitalize="characters"></label>
          <label>Ticker <span class="ayuda">(opcional)</span><input name="ticker" maxlength="20" value="${esc(a.ticker)}" placeholder="VWCE"></label>
        </div>
        <label>Símbolo de datos (EODHD) <span class="ayuda">(para el precio automático)</span>
          <div style="display:flex;gap:8px"><input name="simbolo_datos" maxlength="30" value="${esc(a.simbolo_datos || '')}" placeholder="p. ej. VWCE.XETRA" autocapitalize="characters" style="flex:1">
          <button class="btn pequeno" type="button" id="btn-buscar-simbolo">Buscar por ISIN</button></div>
          <span class="ayuda" id="ayuda-simbolo">Si lo dejas vacío y has puesto el ISIN, la app lo buscará al guardar. No hace falta en liquidez.</span></label>
        <label>Divisa de exposición<select name="divisa_exposicion">${opciones(cat.divisas, a.divisa || 'EUR')}</select>
          <span class="ayuda">La moneda de los activos que contiene, no la de cotización. Un ETF mundial es «Multidivisa»; el oro, «USD».</span></label>
        <label>Notas <span class="ayuda">(opcional)</span><textarea name="notas" rows="2" maxlength="500">${esc(a.notas || '')}</textarea></label>
        <p class="error" role="alert"></p>
        <div class="botonera">
          <button class="btn primario" type="submit">Guardar</button>
          ${a.id ? '<button class="btn peligro" type="button" id="btn-borrar-activo">Eliminar activo</button>' : ''}
        </div>
      </form>`, cuerpo => {
      const f = $('#f-activo', cuerpo);
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        const d = Object.fromEntries(new FormData(f).entries());
        d.id = a.id || '';
        enviarFormulario(f, 'guardarActivo', d, 'Activo guardado');
      });
      $('#btn-buscar-simbolo', cuerpo).addEventListener('click', async ev => {
        const isin = f.isin.value.trim();
        const ayuda = $('#ayuda-simbolo', cuerpo);
        if (!isin) { ayuda.textContent = 'Escribe primero el ISIN.'; return; }
        ev.target.disabled = true; ayuda.textContent = 'Buscando…';
        try {
          const r = await api('buscarSimbolo', { isin: isin });
          f.simbolo_datos.value = r.simbolo;
          ayuda.textContent = 'Encontrado: ' + r.nombre + ' (' + r.bolsa + ', ' + r.divisa + ').' + (r.divisa !== 'EUR' ? ' Atención: no cotiza en euros en esta bolsa.' : '');
        } catch (e) { ayuda.textContent = 'No encontrado: ' + e.message; }
        finally { ev.target.disabled = false; }
      });
      const b = $('#btn-borrar-activo', cuerpo);
      if (b) b.addEventListener('click', () => {
        if (!confirm('¿Eliminar «' + a.nombre + '»? Solo es posible si no tiene operaciones.')) return;
        enviarFormulario(f, 'eliminarActivo', { id: a.id }, 'Activo eliminado');
      });
    });
  }

  function modalOperacion(activoId) {
    const activos = estado.datos.cartera.posiciones;
    if (!activos.length) { toast('Primero añade un activo.'); return; }
    const sel = activoId || activos[0].id;
    abrirModal('Registrar operación', `
      <form class="formulario" id="f-op">
        <label>Activo<select name="activo_id" id="op-activo">${opciones(activos, sel, x => x.id, x => x.nombre)}</select></label>
        <div class="doble">
          <label>Tipo<select name="tipo" id="op-tipo">
            <option value="COMPRA">Compra / ingreso</option><option value="VENTA">Venta / retirada</option><option value="RENTA">Dividendo o interés cobrado</option></select></label>
          <label>Fecha<input name="fecha" type="date" required max="${hoyISO()}" value="${hoyISO()}"></label>
        </div>
        <div id="op-campos"></div>
        <label>Comisión (€)<input name="comision" type="number" inputmode="decimal" min="0" step="0.01" value="0">
          <span class="ayuda">En Trade Republic, normalmente 1 € por orden puntual y 0 € en planes de inversión. Compruébalo en tu extracto.</span></label>
        <label>Notas <span class="ayuda">(opcional)</span><input name="notas" maxlength="300"></label>
        <p class="error" role="alert"></p>
        <button class="btn primario" type="submit">Guardar operación</button>
      </form>`, cuerpo => {
      const f = $('#f-op', cuerpo);
      const campos = () => {
        const a = activos.find(x => x.id === $('#op-activo', cuerpo).value);
        const tipo = $('#op-tipo', cuerpo).value;
        const liq = a && a.categoria === 'LIQUIDEZ';
        $('#op-campos', cuerpo).innerHTML = (tipo === 'RENTA' || liq)
          ? `<label>Importe (€)<input name="importe" type="number" inputmode="decimal" min="0.01" step="0.01" required></label>`
          : `<div class="doble"><label>Participaciones<input name="participaciones" type="number" inputmode="decimal" min="0.000001" step="any" required></label>
             <label>Precio por participación (€)<input name="precio" type="number" inputmode="decimal" min="0.0001" step="any" required></label></div>
             <p class="suave" id="op-total"></p>`;
        const calc = () => {
          const p = parseFloat(f.participaciones && f.participaciones.value), pr = parseFloat(f.precio && f.precio.value);
          const t = $('#op-total', cuerpo);
          if (t) t.textContent = p > 0 && pr > 0 ? 'Importe de la operación: ' + fmtEur(p * pr) + ' (sin comisión)' : '';
        };
        f.oninput = calc;
      };
      $('#op-activo', cuerpo).addEventListener('change', campos);
      $('#op-tipo', cuerpo).addEventListener('change', campos);
      campos();
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        enviarFormulario(f, 'guardarOperacion', Object.fromEntries(new FormData(f).entries()), 'Operación registrada');
      });
    });
  }

  function modalPrecio(a) {
    abrirModal('Actualizar precio', `
      <form class="formulario" id="f-precio">
        <p><strong>${esc(a.nombre)}</strong><br><span class="suave">Precio guardado: ${a.precio_actual ? fmtEur(a.precio_actual, 4) + ' (' + fmtFecha(a.fecha_precio) + ')' : 'ninguno'}</span></p>
        <div class="doble">
          <label>Precio actual (€)<input name="precio" type="number" inputmode="decimal" min="0.0001" step="any" required></label>
          <label>Fecha del precio<input name="fecha" type="date" required max="${hoyISO()}" value="${hoyISO()}"></label>
        </div>
        <p class="suave">Copia el precio que muestra Trade Republic. En la Fase 3 se actualizará automáticamente.</p>
        <p class="error" role="alert"></p>
        <button class="btn primario" type="submit">Guardar precio</button>
      </form>`, cuerpo => {
      const f = $('#f-precio', cuerpo);
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        const d = Object.fromEntries(new FormData(f).entries());
        d.id = a.id;
        enviarFormulario(f, 'actualizarPrecio', d, 'Precio actualizado');
      });
    });
  }

  async function borrarOperacion(id) {
    if (!confirm('¿Eliminar esta operación? Se recalculará toda la cartera.')) return;
    try { await cargar('eliminarOperacion', { id: id }, 'Operación eliminada'); } catch (e) { toast(e.message); }
  }

  function modalAjustes() {
    const cfg = estado.datos ? estado.datos.config : {};
    const con = estado.conexion || {};
    let tema = 'auto';
    try { tema = localStorage.getItem('cp_tema') || 'auto'; } catch (e) {}
    const cats = estado.datos ? estado.datos.catalogos.categorias : [];
    abrirModal('Ajustes', `
      <form class="formulario" id="f-ajustes">
        <h3>Apariencia</h3>
        <label>Tema<select name="tema"><option value="auto" ${tema === 'auto' ? 'selected' : ''}>Automático (según el dispositivo)</option>
          <option value="claro" ${tema === 'claro' ? 'selected' : ''}>Claro</option><option value="oscuro" ${tema === 'oscuro' ? 'selected' : ''}>Oscuro</option></select></label>
        ${estado.datos ? `
        <h3>Tu perfil y plan</h3>
        <div class="doble">
          <label>Aportación mensual (€)<input name="aportacion_mensual" type="number" min="0" step="1" value="${esc(cfg.aportacion_mensual)}"></label>
          <label>Capital inicial (€)<input name="capital_inicial" type="number" min="0" step="1" value="${esc(cfg.capital_inicial)}"></label>
        </div>
        <div class="doble">
          <label>Edad<input name="edad" type="number" min="18" max="100" value="${esc(cfg.edad)}"></label>
          <label>Horizonte (años)<input name="horizonte_anios" type="number" min="1" max="40" value="${esc(cfg.horizonte_anios)}"></label>
        </div>
        <label>¿Tienes fondo de emergencia aparte?<select name="fondo_emergencia">
          <option ${String(cfg.fondo_emergencia).indexOf('S') === 0 ? 'selected' : ''}>Sí</option><option ${String(cfg.fondo_emergencia).indexOf('S') !== 0 ? 'selected' : ''}>No</option></select></label>
        <h3>Pesos objetivo (%) <span class="ayuda" id="suma-obj"></span></h3>
        <div class="doble">${cats.map(c => `<label>${esc(c.nombre)}<input class="obj" name="obj_${esc(c.id)}" type="number" min="0" max="100" step="0.5" value="${esc(cfg['obj_' + c.id])}"></label>`).join('')}</div>
        ` : ''}
        <h3>Conexión</h3>
        <label>Dirección de la aplicación web<input name="url" type="url" value="${esc(con.url || '')}" required></label>
        <label>Código de acceso<input name="token" type="password" value="${esc(con.token || '')}" required minlength="20" autocomplete="off"></label>
        <p class="error" role="alert"></p>
        <div class="botonera">
          <button class="btn primario" type="submit">Guardar</button>
          <button class="btn" type="button" id="btn-mercado">Actualizar datos de mercado</button>
          <button class="btn" type="button" id="btn-precios">Actualizar precios ahora</button>
          <button class="btn peligro" type="button" id="btn-desconectar">Olvidar este dispositivo</button>
        </div>
        <p class="suave">Versión de la app: 1.1.0 · Servidor: ${esc(estado.datos ? estado.datos.app.version : '—')}</p>
      </form>`, cuerpo => {
      const f = $('#f-ajustes', cuerpo);
      const suma = () => {
        const s = Array.from(f.querySelectorAll('.obj')).reduce((t, i) => t + (parseFloat(i.value) || 0), 0);
        const el = $('#suma-obj', cuerpo);
        if (el) { el.textContent = 'Suma: ' + fmtNum(s, 1) + ' %'; el.style.color = Math.abs(s - 100) < 0.01 ? '' : 'var(--negativo)'; }
        return s;
      };
      f.addEventListener('input', suma); suma();
      f.addEventListener('submit', async ev => {
        ev.preventDefault();
        const d = Object.fromEntries(new FormData(f).entries());
        aplicarTema(d.tema);
        const nuevaCon = { url: d.url.trim(), token: d.token.trim() };
        const cambioCon = nuevaCon.url !== con.url || nuevaCon.token !== con.token;
        if (cambioCon) { estado.conexion = nuevaCon; guardarLS(CLAVE_CONEXION, nuevaCon); }
        if (estado.datos && f.querySelector('.obj')) {
          if (Math.abs(suma() - 100) > 0.01) { $('.error', f).textContent = 'Los pesos objetivo deben sumar 100 %.'; return; }
          const cfgNueva = {};
          ['aportacion_mensual', 'capital_inicial', 'edad', 'horizonte_anios', 'fondo_emergencia'].forEach(k => { cfgNueva[k] = d[k]; });
          cats.forEach(c => { cfgNueva['obj_' + c.id] = d['obj_' + c.id]; });
          enviarFormulario(f, 'guardarConfig', cfgNueva, 'Ajustes guardados');
        } else {
          enviarFormulario(f, 'resumen', null, 'Conectado');
        }
      });
      $('#btn-mercado', cuerpo).addEventListener('click', async ev => {
        ev.target.disabled = true;
        try { await cargar('actualizarMercado', null, 'Datos de mercado actualizados'); cerrarModal(); }
        catch (e) { $('.error', f).textContent = e.message; }
        finally { ev.target.disabled = false; }
      });
      $('#btn-precios', cuerpo).addEventListener('click', async ev => {
        ev.target.disabled = true;
        try { await cargar('actualizarPrecios', null, 'Precios actualizados'); cerrarModal(); }
        catch (e) { $('.error', f).textContent = e.message; }
        finally { ev.target.disabled = false; }
      });
      $('#btn-desconectar', cuerpo).addEventListener('click', () => {
        if (!confirm('Se borrarán la conexión y los datos guardados en este dispositivo (no los del servidor).')) return;
        try { localStorage.removeItem(CLAVE_CONEXION); localStorage.removeItem(CLAVE_CACHE); } catch (e) {}
        location.reload();
      });
    });
  }

  function aplicarTema(t) {
    try { localStorage.setItem('cp_tema', t); } catch (e) {}
    if (t === 'claro' || t === 'oscuro') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    pintar();
  }

  /* ---------------- Exportación ---------------- */
  function exportarCSV() {
    const d = estado.datos;
    const sep = ';';
    const n = x => (x === null || x === undefined || x === '') ? '' : String(x).replace('.', ',');
    const t = x => '"' + String(x === null || x === undefined ? '' : x).replace(/"/g, '""') + '"';
    const filas = [['POSICIONES'], ['Nombre', 'ISIN', 'Categoría', 'Tipo', 'Región', 'Divisa', 'Participaciones', 'Precio medio', 'Precio actual', 'Fecha precio', 'Valor', 'Ganancia no realizada', 'Peso %']];
    d.cartera.posiciones.forEach(p => filas.push([t(p.nombre), t(p.isin), t(p.categoria), t(p.tipo), t(p.region), t(p.divisa), n(p.participaciones), n(p.precio_medio), n(p.precio_actual), t(p.fecha_precio), n(p.valor), n(p.latente), n(p.peso)]));
    filas.push([], ['OPERACIONES'], ['Fecha', 'Activo', 'Tipo', 'Participaciones', 'Precio', 'Comisión', 'Importe', 'Notas']);
    const nom = id => (d.cartera.posiciones.find(p => p.id === id) || {}).nombre || id;
    d.operaciones.forEach(o => filas.push([t(o.fecha), t(nom(o.activo_id)), t(o.tipo), n(o.participaciones), n(o.precio), n(o.comision), n(o.importe), t(o.notas)]));
    const csv = '﻿' + filas.map(f => f.join(sep)).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'cartera-patrimonio-' + hoyISO() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------------- Arranque ---------------- */
  function mostrarConexion() {
    document.querySelectorAll('.vista').forEach(v => { v.hidden = true; });
    $('#v-conexion').hidden = false;
    $('.navegacion').hidden = true;
    $('#titulo-pantalla').textContent = 'Cartera Patrimonio';
    const f = $('#form-conexion');
    f.onsubmit = async ev => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f).entries());
      estado.conexion = { url: d.url.trim(), token: d.token.trim() };
      const btn = f.querySelector('button'); btn.disabled = true; $('#conexion-error').textContent = '';
      try {
        await api('ping');
        guardarLS(CLAVE_CONEXION, estado.conexion);
        $('.navegacion').hidden = false;
        $('#v-conexion').hidden = true;
        irA('patrimonio');
        await cargar('resumen');
      } catch (e) {
        estado.conexion = null;
        $('#conexion-error').textContent = 'No se ha podido conectar: ' + e.message;
      } finally { btn.disabled = false; }
    };
  }

  function iniciar() {
    document.querySelectorAll('.navegacion button').forEach(b => b.addEventListener('click', () => irA(b.dataset.vista)));
    $('#btn-ajustes').addEventListener('click', modalAjustes);
    $('#btn-refrescar').addEventListener('click', () => { if (estado.conexion) cargar('resumen', null, 'Datos actualizados').catch(() => {}); });

    estado.conexion = leerLS(CLAVE_CONEXION);
    if (!estado.conexion || !estado.conexion.url) { mostrarConexion(); return; }

    const inicial = (location.hash || '').replace('#', '');
    estado.vista = TITULOS[inicial] ? inicial : 'patrimonio';
    const c = leerLS(CLAVE_CACHE);
    if (c && c.datos) { estado.datos = c.datos; estado.deCache = true; }
    irA(estado.vista);
    if (!estado.datos) $('#v-' + estado.vista).innerHTML = '<div class="esqueleto"></div><div class="esqueleto"></div>';
    actualizarSync();
    cargar('resumen').catch(() => {});

    // Al volver a la app tras un rato, refrescar
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && estado.conexion) {
        const c2 = leerLS(CLAVE_CACHE);
        if (!c2 || Date.now() - new Date(c2.guardado).getTime() > 10 * 60 * 1000) cargar('resumen').catch(() => {});
      }
    });
    // Cambio de tema del sistema → repintar gráficos
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', pintar);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  document.addEventListener('DOMContentLoaded', iniciar);
})();
