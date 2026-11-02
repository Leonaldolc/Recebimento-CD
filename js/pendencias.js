/**
 * pendencias.js
 * Relatório gerencial de notas pendentes entre etapas:
 * 1. Compra recebida e não lançada no fiscal (> N horas)
 * 2. Transferência recebida sem entrada dada (> N horas)
 * 3. Fiscal ou Entrada lançada sem passar pelo recebimento
 * Inclui cards de resumo, quadro por unidade e exportação CSV formatada para Excel em português.
 */
import { obterSupabase } from './auth.js';
import { formatarChave, formatarCnpj } from './validacao.js';

let todasPendencias = [];
let horasAlertaPadrao = 24;

/**
 * Carrega a configuração de horas de alerta da empresa.
 */
export async function carregarConfiguracoesHoras() {
  const supabase = obterSupabase();
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from('configuracoes')
      .select('horas_alerta')
      .limit(1)
      .maybeSingle();

    if (!error && data && data.horas_alerta) {
      horasAlertaPadrao = data.horas_alerta;
      const inputHoras = document.getElementById('filtro-pendencias-horas');
      if (inputHoras) {
        inputHoras.value = horasAlertaPadrao;
      }
    }
  } catch (e) {
    console.warn('Erro ao carregar configurações de horas:', e);
  }
}

/**
 * Consulta as pendências na view vw_pendencias ou via agregação direta de bipes.
 */
export async function carregarPendencias() {
  const supabase = obterSupabase();
  if (!supabase) return;

  const container = document.getElementById('tabela-pendencias-corpo');
  if (container) {
    container.innerHTML = '<tr><td colspan="8" class="text-center py-4">Carregando pendências...</td></tr>';
  }

  try {
    // Tenta primeiro consultar a view do banco
    const { data, error } = await supabase
      .from('vw_pendencias')
      .select('*')
      .order('ultimo_bipe_em', { ascending: true });

    if (!error && data) {
      todasPendencias = data;
    } else {
      // Fallback caso a view ainda não tenha sido criada no Supabase
      console.warn('Consulta à vw_pendencias falhou, consultando bipes diretamente:', error && error.message);
      todasPendencias = await calcularPendenciasDireto();
    }

    preencherFiltroUnidades();
    aplicarFiltrosPendencias();
  } catch (e) {
    console.error('Erro ao carregar relatório de pendências:', e);
    if (container) {
      container.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-danger">Erro ao carregar dados: ${e.message}</td></tr>`;
    }
  }
}

/**
 * Fallback resiliente caso a view SQL não tenha sido executada ainda.
 */
async function calcularPendenciasDireto() {
  const supabase = obterSupabase();
  if (!supabase) return [];

  const { data: bipes, error } = await supabase
    .from('bipes')
    .select('*')
    .order('bipado_em', { ascending: true });

  if (error || !bipes) return [];

  const porChave = new Map();
  for (let i = 0; i < bipes.length; i++) {
    const b = bipes[i];
    if (!porChave.has(b.chave)) {
      porChave.set(b.chave, []);
    }
    porChave.get(b.chave).push(b);
  }

  const pendentes = [];
  const agora = Date.now();

  porChave.forEach((lista, chave) => {
    const temRecebimento = lista.some(b => b.etapa === 'RECEBIMENTO');
    const temFiscal = lista.some(b => b.etapa === 'FISCAL');
    const temEntrada = lista.some(b => b.etapa === 'ENTRADA_DADA');

    // Último bipe da chave
    lista.sort((a, b) => new Date(b.bipado_em) - new Date(a.bipado_em));
    const ultimo = lista[0];
    const horasDesde = Math.round(((agora - new Date(ultimo.bipado_em).getTime()) / 3600000) * 10) / 10;

    let status = null;
    let descricao = '';

    if (ultimo.tipo === 'COMPRA' && temRecebimento && !temFiscal) {
      status = 'COMPRA_SEM_FISCAL';
      descricao = 'Perdida entre recebimento e fiscal';
    } else if (ultimo.tipo === 'TRANSFERENCIA' && temRecebimento && !temEntrada) {
      status = 'TRANSFERENCIA_SEM_ENTRADA';
      descricao = 'Transferência sem entrada dada';
    } else if ((temFiscal || temEntrada) && !temRecebimento) {
      status = 'LANCADA_SEM_RECEBIMENTO';
      descricao = 'Lançada sem passar pelo recebimento';
    }

    if (status) {
      pendentes.push({
        chave,
        tipo: ultimo.tipo,
        numero_nf: ultimo.numero_nf,
        serie: ultimo.serie,
        nome_emitente: ultimo.nome_emitente,
        cnpj_emitente: ultimo.cnpj_emitente,
        recebido_unidade: ultimo.unidade,
        ultima_unidade: ultimo.unidade,
        ultimo_usuario: ultimo.usuario_nome,
        ultima_etapa: ultimo.etapa,
        ultimo_bipe_em: ultimo.bipado_em,
        horas_desde_ultimo_bipe: horasDesde,
        status_pendencia: status,
        descricao_pendencia: descricao
      });
    }
  });

  return pendentes;
}

/**
 * Preenche o seletor de unidades com as unidades existentes nas pendências.
 */
function preencherFiltroUnidades() {
  const select = document.getElementById('filtro-pendencias-unidade');
  if (!select) return;

  const valorAtual = select.value;
  const unidades = new Set();

  todasPendencias.forEach(p => {
    const u = p.ultima_unidade || p.recebido_unidade;
    if (u && u.trim()) unidades.add(u.trim());
  });

  let html = '<option value="">Todas as Unidades</option>';
  Array.from(unidades).sort().forEach(u => {
    html += `<option value="${u}">${u}</option>`;
  });

  select.innerHTML = html;
  if (valorAtual) select.value = valorAtual;
}

/**
 * Aplica os filtros selecionados na tela e renderiza os dados.
 */
export function aplicarFiltrosPendencias() {
  const filtroUnidade = (document.getElementById('filtro-pendencias-unidade')?.value || '').trim();
  const filtroTipo = (document.getElementById('filtro-pendencias-tipo')?.value || '').trim();
  const inputHoras = document.getElementById('filtro-pendencias-horas');
  const horasLimite = inputHoras ? parseFloat(inputHoras.value) || 0 : horasAlertaPadrao;

  const filtradas = todasPendencias.filter(item => {
    // Filtro por Unidade
    const unidadeItem = (item.ultima_unidade || item.recebido_unidade || '').trim();
    if (filtroUnidade && unidadeItem !== filtroUnidade) {
      return false;
    }

    // Filtro por Tipo (COMPRA ou TRANSFERENCIA)
    if (filtroTipo && item.tipo !== filtroTipo) {
      return false;
    }

    // Regra de horas para cada caso:
    // Caso 1 (Compra sem fiscal) e Caso 2 (Transferência sem entrada) respeitam o prazo de N horas
    if (item.status_pendencia === 'COMPRA_SEM_FISCAL' || item.status_pendencia === 'TRANSFERENCIA_SEM_ENTRADA') {
      if (item.horas_desde_ultimo_bipe < horasLimite) {
        return false;
      }
    }
    // Caso 3 (Lançada sem recebimento) é grave e exibe sempre (ou a partir de 0 horas)

    return true;
  });

  // Ordenar pelas mais antigas primeiro (maior número de horas)
  filtradas.sort((a, b) => (b.horas_desde_ultimo_bipe || 0) - (a.horas_desde_ultimo_bipe || 0));

  renderizarCardsResumo(filtradas);
  renderizarQuadroUnidades(filtradas);
  renderizarTabelaPendencias(filtradas);
}

/**
 * Renderiza os cards de resumo no topo.
 */
function renderizarCardsResumo(itens) {
  let countCompras = 0;
  let countTransferencias = 0;
  let countSemRecebimento = 0;

  itens.forEach(i => {
    if (i.status_pendencia === 'COMPRA_SEM_FISCAL') countCompras++;
    else if (i.status_pendencia === 'TRANSFERENCIA_SEM_ENTRADA') countTransferencias++;
    else if (i.status_pendencia === 'LANCADA_SEM_RECEBIMENTO') countSemRecebimento++;
  });

  const elTotal = document.getElementById('card-resumo-total');
  const elCompras = document.getElementById('card-resumo-compras');
  const elTransf = document.getElementById('card-resumo-transferencias');
  const elSemRec = document.getElementById('card-resumo-sem-recebimento');

  if (elTotal) elTotal.innerText = itens.length;
  if (elCompras) elCompras.innerText = countCompras;
  if (elTransf) elTransf.innerText = countTransferencias;
  if (elSemRec) elSemRec.innerText = countSemRecebimento;
}

/**
 * Renderiza o quadro de pendências agrupado por unidade.
 */
function renderizarQuadroUnidades(itens) {
  const container = document.getElementById('quadro-resumo-unidades');
  if (!container) return;

  const porUnidade = {};
  itens.forEach(i => {
    const u = i.ultima_unidade || i.recebido_unidade || 'Sem Unidade';
    porUnidade[u] = (porUnidade[u] || 0) + 1;
  });

  const unidades = Object.keys(porUnidade).sort((a, b) => porUnidade[b] - porUnidade[a]);

  if (unidades.length === 0) {
    container.innerHTML = '<span class="text-muted">Nenhuma pendência encontrada.</span>';
    return;
  }

  let html = '';
  unidades.forEach(u => {
    html += `
      <div class="card-unidade">
        <span class="unidade-nome">${u}</span>
        <span class="unidade-contagem badge-pendente">${porUnidade[u]}</span>
      </div>
    `;
  });

  container.innerHTML = html;
}

/**
 * Renderiza a lista/tabela principal de pendências.
 */
function renderizarTabelaPendencias(itens) {
  const corpo = document.getElementById('tabela-pendencias-corpo');
  if (!corpo) return;

  if (itens.length === 0) {
    corpo.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-6 text-sucesso">
          ✓ Nenhuma nota pendente com os filtros selecionados! Tudo em dia.
        </td>
      </tr>
    `;
    return;
  }

  let html = '';
  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    const badgeTipo = item.tipo === 'TRANSFERENCIA' ? 'badge-transferencia' : 'badge-compra';

    let badgeStatusClass = 'badge-alerta';
    if (item.status_pendencia === 'LANCADA_SEM_RECEBIMENTO') {
      badgeStatusClass = 'badge-perigo';
    }

    const dataHora = formatarDataHora(item.ultimo_bipe_em);
    const horasStr = item.horas_desde_ultimo_bipe ? `${item.horas_desde_ultimo_bipe}h atrás` : '-';

    html += `
      <tr>
        <td>
          <span class="badge ${badgeStatusClass}">${item.descricao_pendencia}</span>
        </td>
        <td>
          <div class="chave-container">
            <span class="chave-codigo" title="${item.chave}">${formatarChaveCurta(item.chave)}</span>
            <button class="btn-copiar-chave" data-chave="${item.chave}" title="Copiar chave completa">📋</button>
          </div>
        </td>
        <td><strong>${item.numero_nf || 'S/N'}</strong> (s.${item.serie || '1'})</td>
        <td>
          <div class="nome-emitente-celula" title="${item.nome_emitente}">${item.nome_emitente || '-'}</div>
          <small class="text-muted">${formatarCnpj(item.cnpj_emitente)}</small>
        </td>
        <td><span class="badge ${badgeTipo}">${item.tipo}</span></td>
        <td><span class="badge-unidade">${item.ultima_unidade || item.recebido_unidade || '-'}</span></td>
        <td>
          <div>${item.ultimo_usuario || '-'}</div>
          <small class="badge badge-etapa">${item.ultima_etapa || '-'}</small>
        </td>
        <td>
          <div>${horasStr}</div>
          <small class="text-muted">${dataHora}</small>
        </td>
      </tr>
    `;
  }

  corpo.innerHTML = html;

  // Ouvinte para botões de cópia de chave
  corpo.querySelectorAll('.btn-copiar-chave').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const chave = this.getAttribute('data-chave');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(chave).then(() => {
          this.innerText = '✓';
          setTimeout(() => { this.innerText = '📋'; }, 1500);
        });
      }
    });
  });
}

function formatarChaveCurta(chave) {
  if (!chave || chave.length !== 44) return chave || '';
  return chave.substring(0, 6) + '...' + chave.substring(38);
}

function formatarDataHora(dataIso) {
  if (!dataIso) return '-';
  const d = new Date(dataIso);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${dia}/${mes} às ${h}:${m}`;
}

/**
 * Exporta a lista filtrada de pendências para arquivo CSV (compatível com Excel em português).
 */
export function exportarCsvPendencias() {
  const filtroUnidade = (document.getElementById('filtro-pendencias-unidade')?.value || '').trim();
  const filtroTipo = (document.getElementById('filtro-pendencias-tipo')?.value || '').trim();
  const inputHoras = document.getElementById('filtro-pendencias-horas');
  const horasLimite = inputHoras ? parseFloat(inputHoras.value) || 0 : horasAlertaPadrao;

  const itens = todasPendencias.filter(item => {
    const unidadeItem = (item.ultima_unidade || item.recebido_unidade || '').trim();
    if (filtroUnidade && unidadeItem !== filtroUnidade) return false;
    if (filtroTipo && item.tipo !== filtroTipo) return false;
    if (item.status_pendencia === 'COMPRA_SEM_FISCAL' || item.status_pendencia === 'TRANSFERENCIA_SEM_ENTRADA') {
      if (item.horas_desde_ultimo_bipe < horasLimite) return false;
    }
    return true;
  });

  if (itens.length === 0) {
    alert('Nenhuma pendência para exportar no momento.');
    return;
  }

  const cabecalho = [
    'Status da Pendencia',
    'Chave de Acesso NF-e',
    'Numero NF',
    'Serie',
    'Tipo',
    'CNPJ Emitente',
    'Nome Emitente',
    'Unidade',
    'Ultimo Bipe Por',
    'Ultima Etapa',
    'Data/Hora Ultimo Bipe',
    'Horas Pendente'
  ];

  const linhas = [cabecalho.join(';')];

  itens.forEach(i => {
    const linha = [
      `"${i.descricao_pendencia || ''}"`,
      `"${i.chave || ''}"`,
      `"${i.numero_nf || ''}"`,
      `"${i.serie || ''}"`,
      `"${i.tipo || ''}"`,
      `"${i.cnpj_emitente || ''}"`,
      `"${(i.nome_emitente || '').replace(/"/g, '""')}"`,
      `"${i.ultima_unidade || i.recebido_unidade || ''}"`,
      `"${(i.ultimo_usuario || '').replace(/"/g, '""')}"`,
      `"${i.ultima_etapa || ''}"`,
      `"${formatarDataHora(i.ultimo_bipe_em)}"`,
      `"${String(i.horas_desde_ultimo_bipe || '').replace('.', ',')}"`
    ];
    linhas.push(linha.join(';'));
  });

  // BOM UTF-8 (\uFEFF) para o Excel em português abrir com acentos corretos
  const conteudoCsv = '\uFEFF' + linhas.join('\r\n');
  const blob = new Blob([conteudoCsv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  const hojeStr = new Date().toISOString().substring(0, 10);
  link.setAttribute('href', url);
  link.setAttribute('download', `pendencias_nfe_${hojeStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Inicializa os botões e filtros da tela de pendências.
 */
export function inicializarEventosPendencias() {
  const btnAtualizar = document.getElementById('btn-atualizar-pendencias');
  const btnExportar = document.getElementById('btn-exportar-csv');
  const filtroUnidade = document.getElementById('filtro-pendencias-unidade');
  const filtroTipo = document.getElementById('filtro-pendencias-tipo');
  const filtroHoras = document.getElementById('filtro-pendencias-horas');

  if (btnAtualizar) btnAtualizar.addEventListener('click', carregarPendencias);
  if (btnExportar) btnExportar.addEventListener('click', exportarCsvPendencias);
  if (filtroUnidade) filtroUnidade.addEventListener('change', aplicarFiltrosPendencias);
  if (filtroTipo) filtroTipo.addEventListener('change', aplicarFiltrosPendencias);
  if (filtroHoras) filtroHoras.addEventListener('input', aplicarFiltrosPendencias);
}
