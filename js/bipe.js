/**
 * bipe.js
 * Lógica principal da tela de bipe: foco contínuo no leitor, controle de teclado virtual,
 * som (Web Audio API), vibração, regras de negócio e gravação no Supabase / Fila Offline.
 */
import { validarChave, classificar, extrairCampos, formatarChave, formatarCnpj } from './validacao.js';
import { adicionarFila, tamanhoFila, sincronizarFila } from './fila-offline.js';
import { obterSupabase } from './auth.js';

let cachesCentros = new Map(); // cnpj -> nome
let cachesFornecedores = new Map(); // cnpj -> nome
let bipesHoje = [];
let modoEntradaAtivo = false;
let tecladoHabilitado = false;
let processandoBipe = false;

// Instância de áudio reutilizável
let audioCtx = null;

function obterAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Emite bipe sonoro de alta qualidade usando Web Audio API.
 * @param {'ok'|'aviso'|'erro'} tipo 
 */
export function tocarSom(tipo) {
  try {
    const ctx = obterAudioContext();
    if (!ctx) return;

    const agora = ctx.currentTime;

    if (tipo === 'ok') {
      // Dois tons rápidos e harmônicos (agradáveis de sucesso)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, agora); // Lá 5
      gain1.gain.setValueAtTime(0.3, agora);
      gain1.gain.exponentialRampToValueAtTime(0.01, agora + 0.1);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(agora);
      osc1.stop(agora + 0.1);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1760, agora + 0.08); // Lá 6
      gain2.gain.setValueAtTime(0.3, agora + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.01, agora + 0.22);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(agora + 0.08);
      osc2.stop(agora + 0.22);
    } else if (tipo === 'aviso') {
      // Tom médio de atenção
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(520, agora);
      gain.gain.setValueAtTime(0.3, agora);
      gain.gain.exponentialRampToValueAtTime(0.01, agora + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(agora);
      osc.stop(agora + 0.25);
    } else if (tipo === 'erro') {
      // Tom grave duplo tipo "buzzer"
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, agora);
      osc.frequency.setValueAtTime(180, agora + 0.12);
      gain.gain.setValueAtTime(0.4, agora);
      gain.gain.exponentialRampToValueAtTime(0.01, agora + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(agora);
      osc.stop(agora + 0.35);
    }
  } catch (e) {
    console.warn('Web Audio indisponível:', e);
  }
}

/**
 * Dispara padrão de vibração tátil (Android/coletor).
 * @param {'ok'|'aviso'|'erro'} tipo 
 */
export function vibrar(tipo) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      if (tipo === 'ok') {
        navigator.vibrate([100]);
      } else if (tipo === 'aviso') {
        navigator.vibrate([120, 80, 120]);
      } else if (tipo === 'erro') {
        navigator.vibrate([300, 100, 300]);
      }
    } catch (e) {
      // Alguns navegadores desabilitam vibração sem ação direta do usuário
    }
  }
}

/**
 * Carrega a tabela de centros e fornecedores para busca instantânea em memória durante o bipe.
 */
export async function carregarCachesCadastros() {
  const supabase = obterSupabase();
  if (!supabase) return;

  try {
    const [resCentros, resForn] = await Promise.all([
      supabase.from('centros').select('cnpj, nome'),
      supabase.from('fornecedores').select('cnpj, nome')
    ]);

    if (resCentros.data) {
      cachesCentros.clear();
      resCentros.data.forEach(c => {
        cachesCentros.set(c.cnpj.trim(), c.nome.trim());
      });
    }

    if (resForn.data) {
      cachesFornecedores.clear();
      resForn.data.forEach(f => {
        cachesFornecedores.set(f.cnpj.trim(), f.nome.trim());
      });
    }
  } catch (e) {
    console.warn('Erro ao carregar caches de centros/fornecedores:', e);
  }
}

/**
 * Carrega os bipes do usuário realizados hoje para o histórico local e contador.
 * @param {string} usuarioId 
 */
export async function carregarBipesHoje(usuarioId) {
  const supabase = obterSupabase();
  if (!supabase || !usuarioId) return;

  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('bipes')
      .select('*')
      .eq('usuario_id', usuarioId)
      .gte('bipado_em', hoje.toISOString())
      .order('bipado_em', { ascending: false })
      .limit(50);

    if (!error && data) {
      bipesHoje = data;
      renderizarUltimosBipes();
      atualizarContadorHoje();
    }
  } catch (e) {
    console.warn('Erro ao carregar bipes de hoje:', e);
  }
}

/**
 * Mantém o campo do leitor sempre focado.
 */
export function manterFocoLeitor() {
  const input = document.getElementById('input-chave');
  if (input && document.activeElement !== input) {
    // Não rouba foco se o usuário estiver digitando em campos de cadastro ou login
    const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    const id = document.activeElement ? document.activeElement.id : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (id !== 'input-chave') return;
    }
    input.focus();
  }
}

/**
 * Alterna entre teclado virtual ligado (para digitação manual) e desligado (modo coletor).
 */
export function alternarTeclado() {
  const input = document.getElementById('input-chave');
  const btn = document.getElementById('btn-toggle-teclado');
  if (!input) return;

  tecladoHabilitado = !tecladoHabilitado;

  if (tecladoHabilitado) {
    input.setAttribute('inputmode', 'numeric');
    if (btn) btn.innerHTML = '⌨ Teclado (LIGADO)';
    if (btn) btn.classList.add('ativo');
  } else {
    input.setAttribute('inputmode', 'none');
    if (btn) btn.innerHTML = '⌨ Teclado (Desligado)';
    if (btn) btn.classList.remove('ativo');
  }
  input.focus();
}

/**
 * Alterna o Modo Entrada (para recebimento de transferências entre centros).
 */
export function alternarModoEntrada() {
  modoEntradaAtivo = !modoEntradaAtivo;
  atualizarEstiloModoEntrada();
  manterFocoLeitor();
}

function atualizarEstiloModoEntrada() {
  const btn = document.getElementById('btn-modo-entrada');
  const banner = document.getElementById('banner-modo-entrada');
  const bipeCard = document.getElementById('card-bipe');

  if (modoEntradaAtivo) {
    if (btn) {
      btn.classList.add('modo-entrada-ativo');
      btn.innerHTML = '🔴 SAIR DO MODO ENTRADA';
    }
    if (banner) {
      banner.style.display = 'block';
    }
    if (bipeCard) {
      bipeCard.classList.add('borda-modo-entrada');
    }
  } else {
    if (btn) {
      btn.classList.remove('modo-entrada-ativo');
      btn.innerHTML = '📥 Dar Entrada (Transferência)';
    }
    if (banner) {
      banner.style.display = 'none';
    }
    if (bipeCard) {
      bipeCard.classList.remove('borda-modo-entrada');
    }
  }
}

/**
 * Determina a etapa com base no perfil do usuário e no modo ativo.
 * @param {object} perfil 
 * @returns {string} 'RECEBIMENTO' | 'FISCAL' | 'ENTRADA_DADA'
 */
export function determinarEtapa(perfil) {
  if (modoEntradaAtivo) {
    return 'ENTRADA_DADA';
  }

  const papel = perfil ? perfil.papel : 'RECEBIMENTO';

  if (papel === 'ADMIN') {
    const seletor = document.getElementById('select-etapa-admin');
    if (seletor && seletor.value) {
      return seletor.value;
    }
    return 'RECEBIMENTO';
  }

  if (papel === 'FISCAL') {
    return 'FISCAL';
  }

  return 'RECEBIMENTO';
}

/**
 * Processa a chave recebida pelo leitor de código de barras ou digitação.
 * @param {string} chaveBruta 
 * @param {object} usuarioPerfil 
 */
export async function processarBipe(chaveBruta, usuarioPerfil) {
  if (processandoBipe) return;
  processandoBipe = true;

  const input = document.getElementById('input-chave');
  if (input) input.value = '';

  try {
    // 1. Validação de formato e Dígito Verificador (Módulo 11)
    const validacao = validarChave(chaveBruta);

    if (!validacao.valido) {
      exibirResultado({
        status: 'erro',
        titulo: 'LEITURA RECUSADA',
        mensagem: validacao.erro,
        detalhes: 'Chave lida: ' + (validacao.chave || chaveBruta)
      });
      tocarSom('erro');
      vibrar('erro');
      return;
    }

    const campos = validacao.campos;
    const chave = validacao.chave;

    // 2. Classificação: COMPRA ou TRANSFERÊNCIA
    const classificacao = classificar(campos.cnpjEmitente, cachesCentros, cachesFornecedores);
    const tipo = classificacao.tipo;
    const nomeEmitente = classificacao.nomeEmitente;

    // 3. Determinar Etapa
    const etapa = determinarEtapa(usuarioPerfil);

    // 4. Verificação de Duplicidade e Regras Prévias
    const supabase = obterSupabase();
    let bipeExistenteMesmaEtapa = null;
    let bipeRecebimentoPrevio = null;

    if (supabase && navigator.onLine) {
      try {
        const { data: bipesChave, error: errBusca } = await supabase
          .from('bipes')
          .select('id, etapa, usuario_nome, bipado_em, tipo')
          .eq('chave', chave);

        if (!errBusca && bipesChave) {
          bipeExistenteMesmaEtapa = bipesChave.find(b => b.etapa === etapa);
          bipeRecebimentoPrevio = bipesChave.find(b => b.etapa === 'RECEBIMENTO');
        }
      } catch (e) {
        console.warn('Erro ao consultar duplicidade online:', e);
      }
    }

    // Regra 6: Duplicidade na mesma etapa -> AVISO LARANJA e NÃO grava de novo
    if (bipeExistenteMesmaEtapa) {
      const dataHora = formatarHoraMinuto(bipeExistenteMesmaEtapa.bipado_em);
      exibirResultado({
        status: 'aviso',
        titulo: 'NOTA JÁ BIPADA NESTA ETAPA',
        mensagem: `Essa nota já foi bipada em ${etapa} por ${bipeExistenteMesmaEtapa.usuario_nome || 'outro operador'} às ${dataHora}.`,
        tipo,
        nomeEmitente,
        numeroNf: campos.numeroNf,
        serie: campos.serie,
        chave
      });
      tocarSom('aviso');
      vibrar('aviso');
      return;
    }

    // Regra 7: Regras por Etapa
    let alerta = null;
    let avisoEspecial = validacao.aviso;

    if (etapa === 'ENTRADA_DADA') {
      // ENTRADA_DADA só vale para TRANSFERENCIA
      if (tipo !== 'TRANSFERENCIA') {
        exibirResultado({
          status: 'erro',
          titulo: 'ENTRADA RECUSADA',
          mensagem: 'Entrada só é permitida para notas de Transferência (emitidas por centros internos). Esta nota é de COMPRA.',
          tipo,
          nomeEmitente,
          numeroNf: campos.numeroNf,
          serie: campos.serie,
          chave
        });
        tocarSom('erro');
        vibrar('erro');
        return;
      }

      // ENTRADA_DADA exige bipe prévio de RECEBIMENTO
      if (supabase && navigator.onLine && !bipeRecebimentoPrevio) {
        exibirResultado({
          status: 'erro',
          titulo: 'FALTA RECEBIMENTO PRÉVIO',
          mensagem: 'A nota de transferência ainda não foi bipada no RECEBIMENTO. Bipe no recebimento antes de dar entrada.',
          tipo,
          nomeEmitente,
          numeroNf: campos.numeroNf,
          serie: campos.serie,
          chave
        });
        tocarSom('erro');
        vibrar('erro');
        return;
      }
    }

    if (etapa === 'FISCAL') {
      // Transferência no fiscal -> Gravar mesmo assim com alerta
      if (tipo === 'TRANSFERENCIA') {
        alerta = 'FISCAL_EM_TRANSFERENCIA';
        avisoEspecial = 'Atenção: Transferência normalmente não passa pelo fiscal.';
      }
      // Compra no fiscal sem recebimento prévio -> Gravar com alerta
      if (tipo === 'COMPRA' && supabase && navigator.onLine && !bipeRecebimentoPrevio) {
        alerta = 'FISCAL_SEM_RECEBIMENTO';
        avisoEspecial = 'Atenção: Fiscal bipado sem recebimento físico prévio da mercadoria.';
      }
    }

    // 5. Montar Objeto do Bipe
    const agoraIso = new Date().toISOString();
    const novoBipe = {
      chave,
      etapa,
      tipo,
      cnpj_emitente: campos.cnpjEmitente,
      nome_emitente: nomeEmitente,
      numero_nf: campos.numeroNf,
      serie: campos.serie,
      alerta,
      usuario_id: usuarioPerfil.id,
      usuario_nome: usuarioPerfil.nome || usuarioPerfil.email,
      unidade: usuarioPerfil.unidade || '',
      bipado_em: agoraIso
    };

    // 6. Gravação (Online no Supabase ou Offline na fila)
    let gravadoComSucesso = false;
    let modoOffline = false;

    if (navigator.onLine && supabase) {
      try {
        const { data, error } = await supabase.from('bipes').insert(novoBipe);
        if (error) {
          // Se o banco acusou duplicidade (caso tenha vindo de outra máquina no mesmo segundo)
          if (error.code === '23505') {
            exibirResultado({
              status: 'aviso',
              titulo: 'NOTA JÁ BIPADA NESTA ETAPA',
              mensagem: 'Esta nota acabou de ser registrada por outro terminal.',
              tipo,
              nomeEmitente,
              numeroNf: campos.numeroNf,
              serie: campos.serie,
              chave
            });
            tocarSom('aviso');
            vibrar('aviso');
            return;
          }

          // Se for erro de trigger do banco
          if (error.message && error.message.indexOf('recebida primeiro') !== -1) {
            exibirResultado({
              status: 'erro',
              titulo: 'FALTA RECEBIMENTO PRÉVIO',
              mensagem: error.message,
              tipo,
              nomeEmitente,
              numeroNf: campos.numeroNf,
              serie: campos.serie,
              chave
            });
            tocarSom('erro');
            vibrar('erro');
            return;
          }

          console.warn('Falha no Supabase, enviando para fila offline:', error.message);
          adicionarFila(novoBipe);
          gravadoComSucesso = true;
          modoOffline = true;
        } else {
          gravadoComSucesso = true;
        }
      } catch (errRede) {
        console.warn('Falha de rede, salvando na fila offline:', errRede);
        adicionarFila(novoBipe);
        gravadoComSucesso = true;
        modoOffline = true;
      }
    } else {
      // Galpão sem internet: Fila Offline
      adicionarFila(novoBipe);
      gravadoComSucesso = true;
      modoOffline = true;
    }

    if (gravadoComSucesso) {
      // Atualizar lista local
      bipesHoje.unshift(novoBipe);
      renderizarUltimosBipes();
      atualizarContadorHoje();

      if (avisoEspecial) {
        exibirResultado({
          status: 'aviso',
          titulo: modoOffline ? 'BIPADO OFFLINE (AVISO)' : 'BIPADO COM SUCESSO (AVISO)',
          mensagem: avisoEspecial + (modoOffline ? ' (Salvo localmente para envio posterior)' : ''),
          tipo,
          nomeEmitente,
          numeroNf: campos.numeroNf,
          serie: campos.serie,
          chave,
          etapa
        });
        tocarSom('aviso');
        vibrar('aviso');
      } else {
        exibirResultado({
          status: 'ok',
          titulo: modoOffline ? 'GRAVADO NA FILA OFFLINE' : 'BIPADO COM SUCESSO',
          mensagem: `Etapa ${etapa} registrada com êxito.` + (modoOffline ? ' Envio pendente de internet.' : ''),
          tipo,
          nomeEmitente,
          numeroNf: campos.numeroNf,
          serie: campos.serie,
          chave,
          etapa
        });
        tocarSom('ok');
        vibrar('ok');
      }
    }
  } finally {
    processandoBipe = false;
    manterFocoLeitor();
  }
}

/**
 * Exibe o painel de resultado colorido e detalhado.
 */
function exibirResultado(dados) {
  const painel = document.getElementById('painel-resultado');
  if (!painel) return;

  painel.className = 'painel-resultado ' + dados.status;

  let badgeTipoHtml = '';
  if (dados.tipo) {
    const badgeClass = dados.tipo === 'TRANSFERENCIA' ? 'badge-transferencia' : 'badge-compra';
    badgeTipoHtml = `<span class="badge ${badgeClass}">${dados.tipo}</span>`;
  }

  let badgeEtapaHtml = '';
  if (dados.etapa) {
    badgeEtapaHtml = `<span class="badge badge-etapa">${dados.etapa}</span>`;
  }

  painel.innerHTML = `
    <div class="resultado-header">
      <div class="resultado-icone">${dados.status === 'ok' ? '✓' : dados.status === 'aviso' ? '⚠' : '✕'}</div>
      <div class="resultado-titulo-bloco">
        <h2 class="resultado-titulo">${dados.titulo}</h2>
        <p class="resultado-mensagem">${dados.mensagem}</p>
      </div>
    </div>
    ${dados.chave ? `
      <div class="resultado-detalhes">
        <div class="linha-detalhe">
          <span class="detalhe-rotulo">Emitente:</span>
          <span class="detalhe-valor destaque">${dados.nomeEmitente || '-'}</span>
          ${badgeTipoHtml}
          ${badgeEtapaHtml}
        </div>
        <div class="linha-detalhe grade-nf">
          <div><span class="detalhe-rotulo">NF:</span> <strong>${dados.numeroNf || '-'}</strong></div>
          <div><span class="detalhe-rotulo">Série:</span> <strong>${dados.serie || '-'}</strong></div>
        </div>
        <div class="linha-detalhe">
          <span class="detalhe-rotulo">Chave:</span>
          <span class="detalhe-chave">${formatarChave(dados.chave)}</span>
        </div>
      </div>
    ` : ''}
  `;
}

/**
 * Renderiza os últimos 10 bipes do usuário na interface.
 */
function renderizarUltimosBipes() {
  const lista = document.getElementById('lista-ultimos-bipes');
  if (!lista) return;

  const ultimos10 = bipesHoje.slice(0, 10);
  if (ultimos10.length === 0) {
    lista.innerHTML = '<div class="lista-vazia">Nenhum bipe registrado hoje ainda.</div>';
    return;
  }

  let html = '';
  for (let i = 0; i < ultimos10.length; i++) {
    const b = ultimos10[i];
    const hora = formatarHoraMinuto(b.bipado_em);
    const badgeTipo = b.tipo === 'TRANSFERENCIA' ? 'badge-transferencia' : 'badge-compra';

    html += `
      <div class="item-bipe">
        <div class="item-bipe-info">
          <div class="item-bipe-topo">
            <span class="item-bipe-nf">NF ${b.numero_nf || 'S/N'}</span>
            <span class="badge ${badgeTipo}">${b.tipo}</span>
            <span class="badge badge-etapa">${b.etapa}</span>
            ${b.alerta ? `<span class="badge badge-alerta" title="${b.alerta}">⚠ Alerta</span>` : ''}
          </div>
          <div class="item-bipe-emitente">${b.nome_emitente || 'Emitente não identificado'}</div>
          <div class="item-bipe-chave">${formatarChave(b.chave)}</div>
        </div>
        <div class="item-bipe-hora">${hora}</div>
      </div>
    `;
  }

  lista.innerHTML = html;
}

function atualizarContadorHoje() {
  const badge = document.getElementById('contador-bipadas-hoje');
  if (badge) {
    badge.innerText = bipesHoje.length;
  }
}

function formatarHoraMinuto(dataIso) {
  if (!dataIso) return '--:--';
  const d = new Date(dataIso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Inicializa os ouvintes de teclado, leitor de código de barras e foco.
 * @param {object} usuarioPerfil 
 */
export function inicializarEventosLeitor(usuarioPerfil) {
  const input = document.getElementById('input-chave');
  const btnTeclado = document.getElementById('btn-toggle-teclado');
  const btnEntrada = document.getElementById('btn-modo-entrada');

  if (btnTeclado) {
    btnTeclado.addEventListener('click', alternarTeclado);
  }

  if (btnEntrada) {
    btnEntrada.addEventListener('click', alternarModoEntrada);
  }

  // Refocar ao tocar em qualquer área neutra da tela
  document.addEventListener('click', function(e) {
    const target = e.target;
    // Não rouba foco se o usuário clicou em botão, link ou outro input
    if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'SELECT' ||
       (target.tagName === 'INPUT' && target.id !== 'input-chave')) {
      return;
    }
    manterFocoLeitor();
  });

  if (input) {
    // Processar no Enter enviado pelo leitor
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const valor = input.value;
        if (valor && valor.trim().length > 0) {
          processarBipe(valor, usuarioPerfil);
        }
      }
    });

    // Processar automaticamente ao atingir 44 dígitos numéricos (para leitores sem Enter)
    input.addEventListener('input', function() {
      const limpo = input.value.replace(/\D/g, '');
      if (limpo.length >= 44) {
        processarBipe(limpo, usuarioPerfil);
      }
    });
  }

  // Carrega os cadastros para busca instantânea em memória
  carregarCachesCadastros();
  if (usuarioPerfil && usuarioPerfil.id) {
    carregarBipesHoje(usuarioPerfil.id);
  }

  manterFocoLeitor();
}
