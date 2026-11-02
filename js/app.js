/**
 * app.js
 * Orquestrador principal da aplicação Chave da NF.
 * Gerencia rotas por hash (#bipar, #pendencias, #consulta, #cadastros),
 * ciclo de vida da autenticação, sincronização de rede e tela de consulta de chaves.
 */
import {
  configuracaoValida,
  obterSupabase,
  obterUsuarioAtual,
  login,
  cadastrar,
  logout,
  onAuthStateChange
} from './auth.js';
import {
  inicializarEventosLeitor,
  manterFocoLeitor,
  processarBipe
} from './bipe.js';
import {
  inicializarEventosPendencias,
  carregarPendencias,
  carregarConfiguracoesHoras
} from './pendencias.js';
import {
  inicializarEventosCadastros,
  carregarCentros,
  carregarFornecedores,
  carregarUsuarios
} from './cadastros.js';
import {
  onMudancaFila,
  tamanhoFila,
  sincronizarFila,
  inicializarSincronizacaoOffline
} from './fila-offline.js';
import { formatarChave, formatarCnpj, extrairCampos, validarChave } from './validacao.js';

let rotaAtual = '#bipar';

/**
 * Inicialização ao carregar a página.
 */
document.addEventListener('DOMContentLoaded', async () => {
  configurarIndicadorRede();
  configurarOuvinteFilaOffline();

  // Verificar se o arquivo config.js ainda tem os placeholders padrão
  if (!configuracaoValida()) {
    const banner = document.getElementById('banner-config-pendente');
    if (banner) banner.style.display = 'block';
  }

  const supabase = obterSupabase();
  if (supabase) {
    inicializarSincronizacaoOffline(supabase);
  }

  configurarEventosAuth();
  configurarEventosNavegacao();
  configurarEventosConsulta();

  // Escutar mudanças de autenticação
  onAuthStateChange((evento, dados) => {
    atualizarInterfaceUsuario(dados.perfil);
  });

  // Verificar sessão salva
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data && data.session && data.session.user) {
      const { carregarPerfil } = await import('./auth.js');
      const res = await carregarPerfil(data.session.user.id);
      if (res.sucesso) {
        atualizarInterfaceUsuario(res.perfil);
      } else {
        atualizarInterfaceUsuario(null);
      }
    } else {
      atualizarInterfaceUsuario(null);
    }
  } else {
    atualizarInterfaceUsuario(null);
  }
});

/**
 * Configura o indicador de conexão Online/Offline.
 */
function configurarIndicadorRede() {
  const badge = document.getElementById('badge-status-rede');

  function atualizarStatus() {
    if (navigator.onLine) {
      if (badge) {
        badge.className = 'badge-rede online';
        badge.innerText = 'ONLINE';
      }
    } else {
      if (badge) {
        badge.className = 'badge-rede offline';
        badge.innerText = 'OFFLINE';
      }
    }
  }

  window.addEventListener('online', atualizarStatus);
  window.addEventListener('offline', atualizarStatus);
  atualizarStatus();
}

/**
 * Configura o ouvinte de contagem da fila offline no cabeçalho.
 */
function configurarOuvinteFilaOffline() {
  const badgeFila = document.getElementById('badge-fila-offline');

  onMudancaFila(qtd => {
    if (!badgeFila) return;
    if (qtd > 0) {
      badgeFila.style.display = 'inline-flex';
      badgeFila.innerText = `${qtd} pendente${qtd > 1 ? 's' : ''}`;
    } else {
      badgeFila.style.display = 'none';
    }
  });
}

/**
 * Atualiza o estado da interface (telas de Login, Aguardando Liberação ou Aplicação).
 * @param {object|null} perfil 
 */
function atualizarInterfaceUsuario(perfil) {
  const secaoAuth = document.getElementById('secao-auth');
  const secaoAguardando = document.getElementById('secao-aguardando-liberacao');
  const secaoApp = document.getElementById('secao-app');
  const seletorEtapaAdmin = document.getElementById('container-seletor-admin');
  const tabCadastros = document.getElementById('tab-nav-cadastros');
  const tabPendencias = document.getElementById('tab-nav-pendencias');

  if (!perfil) {
    // Não autenticado
    if (secaoAuth) secaoAuth.style.display = 'flex';
    if (secaoAguardando) secaoAguardando.style.display = 'none';
    if (secaoApp) secaoApp.style.display = 'none';
    return;
  }

  if (!perfil.ativo) {
    // Autenticado porém inativo (aguardando liberação do ADMIN)
    if (secaoAuth) secaoAuth.style.display = 'none';
    if (secaoAguardando) secaoAguardando.style.display = 'flex';
    if (secaoApp) secaoApp.style.display = 'none';

    const spanNome = document.getElementById('span-aguardando-nome');
    if (spanNome) spanNome.innerText = perfil.nome || perfil.email;
    return;
  }

  // Usuário autenticado e ativo! Exibe o aplicativo principal
  if (secaoAuth) secaoAuth.style.display = 'none';
  if (secaoAguardando) secaoAguardando.style.display = 'none';
  if (secaoApp) secaoApp.style.display = 'block';

  // Atualizar dados no cabeçalho
  const elNome = document.getElementById('usuario-topo-nome');
  const elPapel = document.getElementById('usuario-topo-papel');
  const elUnidade = document.getElementById('usuario-topo-unidade');

  if (elNome) elNome.innerText = perfil.nome || perfil.email;
  if (elPapel) {
    elPapel.innerText = perfil.papel;
    elPapel.className = 'badge badge-papel-' + perfil.papel.toLowerCase();
  }
  if (elUnidade) elUnidade.innerText = perfil.unidade ? `Unidade ${perfil.unidade}` : 'Sem unidade';

  // Controle de visibilidade por perfil
  if (tabCadastros) {
    tabCadastros.style.display = perfil.papel === 'ADMIN' ? 'inline-block' : 'none';
  }
  if (tabPendencias) {
    tabPendencias.style.display = (perfil.papel === 'ADMIN' || perfil.papel === 'FISCAL') ? 'inline-block' : 'none';
  }
  if (seletorEtapaAdmin) {
    seletorEtapaAdmin.style.display = perfil.papel === 'ADMIN' ? 'block' : 'none';
  }

  // Inicializar módulos da aplicação
  inicializarEventosLeitor(perfil);
  inicializarEventosPendencias();
  if (perfil.papel === 'ADMIN') {
    inicializarEventosCadastros();
  }

  // Navegar para a rota correta
  navegarParaHash(window.location.hash || '#bipar');
}

/**
 * Gerenciador de rotas SPA por hash (#bipar, #pendencias, #consulta, #cadastros).
 */
function configurarEventosNavegacao() {
  window.addEventListener('hashchange', () => {
    navegarParaHash(window.location.hash);
  });

  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      const hash = this.getAttribute('href');
      window.location.hash = hash;
    });
  });
}

function navegarParaHash(hash) {
  const rotasPermitidas = ['#bipar', '#pendencias', '#consulta', '#cadastros'];
  rotaAtual = rotasPermitidas.indexOf(hash) !== -1 ? hash : '#bipar';

  const perfil = obterUsuarioAtual().perfil;
  // Proteção de rota para Cadastros (apenas ADMIN)
  if (rotaAtual === '#cadastros' && perfil && perfil.papel !== 'ADMIN') {
    rotaAtual = '#bipar';
    window.location.hash = '#bipar';
  }

  // Atualizar visual das abas
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    if (btn.getAttribute('href') === rotaAtual) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Ocultar todas as views e exibir a rota ativa
  document.querySelectorAll('.view-conteudo').forEach(view => {
    view.style.display = 'none';
  });

  const viewAtiva = document.getElementById('view-' + rotaAtual.replace('#', ''));
  if (viewAtiva) {
    viewAtiva.style.display = 'block';
  }

  // Ações específicas ao abrir cada tela
  if (rotaAtual === '#bipar') {
    manterFocoLeitor();
  } else if (rotaAtual === '#pendencias') {
    carregarConfiguracoesHoras();
    carregarPendencias();
  } else if (rotaAtual === '#cadastros') {
    carregarCentros();
    carregarFornecedores();
    carregarUsuarios();
  }
}

/**
 * Configura formulários de login, cadastro e logout.
 */
function configurarEventosAuth() {
  const formLogin = document.getElementById('form-login');
  const formCadastro = document.getElementById('form-cadastro');
  const btnToggleAuth = document.getElementById('btn-toggle-auth-modo');
  const btnLogout = document.getElementById('btn-logout');
  const btnLogoutAguardando = document.getElementById('btn-logout-aguardando');
  const btnVerificarAprovacao = document.getElementById('btn-verificar-aprovacao');

  let modoCriarConta = false;

  if (btnToggleAuth) {
    btnToggleAuth.addEventListener('click', () => {
      modoCriarConta = !modoCriarConta;
      if (modoCriarConta) {
        if (formLogin) formLogin.style.display = 'none';
        if (formCadastro) formCadastro.style.display = 'block';
        btnToggleAuth.innerText = 'Já tem uma conta? Fazer Login';
      } else {
        if (formLogin) formLogin.style.display = 'block';
        if (formCadastro) formCadastro.style.display = 'none';
        btnToggleAuth.innerText = 'Não tem conta? Criar nova conta';
      }
    });
  }

  if (formLogin) {
    formLogin.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const senha = document.getElementById('login-senha').value;
      const btn = formLogin.querySelector('button[type="submit"]');

      btn.disabled = true;
      btn.innerText = 'Entrando...';

      const res = await login(email, senha);
      btn.disabled = false;
      btn.innerText = 'Entrar';

      if (res.sucesso) {
        atualizarInterfaceUsuario(res.perfil);
      } else {
        alert('Erro ao entrar: ' + res.erro);
      }
    });
  }

  if (formCadastro) {
    formCadastro.addEventListener('submit', async e => {
      e.preventDefault();
      const nome = document.getElementById('cadastro-nome').value;
      const email = document.getElementById('cadastro-email').value;
      const senha = document.getElementById('cadastro-senha').value;
      const btn = formCadastro.querySelector('button[type="submit"]');

      btn.disabled = true;
      btn.innerText = 'Criando conta...';

      const res = await cadastrar(nome, email, senha);
      btn.disabled = false;
      btn.innerText = 'Criar Conta';

      if (res.sucesso) {
        if (res.aguardando) {
          alert('Conta criada com sucesso! Seu cadastro precisa ser liberado pelo supervisor (ADMIN).');
        }
        atualizarInterfaceUsuario(res.perfil);
      } else {
        alert('Erro ao criar conta: ' + res.erro);
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await logout();
      atualizarInterfaceUsuario(null);
    });
  }

  if (btnLogoutAguardando) {
    btnLogoutAguardando.addEventListener('click', async () => {
      await logout();
      atualizarInterfaceUsuario(null);
    });
  }

  if (btnVerificarAprovacao) {
    btnVerificarAprovacao.addEventListener('click', async () => {
      const supabase = obterSupabase();
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      if (data && data.user) {
        const { carregarPerfil } = await import('./auth.js');
        const res = await carregarPerfil(data.user.id);
        if (res.sucesso && res.perfil.ativo) {
          alert('Seu cadastro foi liberado! Seja bem-vindo.');
          atualizarInterfaceUsuario(res.perfil);
        } else {
          alert('Seu perfil ainda não foi ativado pelo supervisor.');
        }
      }
    });
  }
}

/**
 * Configura a tela de Consulta detalhada de chave da NF.
 */
function configurarEventosConsulta() {
  const inputConsulta = document.getElementById('input-consulta-chave');
  const btnBuscar = document.getElementById('btn-buscar-consulta');
  const resultadoConsulta = document.getElementById('resultado-consulta-historico');

  async function executarConsulta() {
    if (!inputConsulta || !resultadoConsulta) return;
    const chave = inputConsulta.value.replace(/\D/g, '').trim();

    if (chave.length !== 44) {
      alert('Informe uma chave de acesso válida de 44 dígitos.');
      return;
    }

    resultadoConsulta.innerHTML = '<div class="text-center py-6 text-muted">Consultando histórico da nota...</div>';

    const supabase = obterSupabase();
    if (!supabase) {
      resultadoConsulta.innerHTML = '<div class="text-danger py-4">Sem conexão com o banco de dados.</div>';
      return;
    }

    try {
      const campos = extrairCampos(chave);

      const { data: bipes, error } = await supabase
        .from('bipes')
        .select('*')
        .eq('chave', chave)
        .order('bipado_em', { ascending: true });

      if (error) throw error;

      if (!bipes || bipes.length === 0) {
        resultadoConsulta.innerHTML = `
          <div class="card-resultado-consulta aviso">
            <h3>Nenhum registro encontrado</h3>
            <p>A chave <code>${formatarChave(chave)}</code> ainda não foi bipada em nenhuma etapa nesta empresa.</p>
          </div>
        `;
        return;
      }

      // Detalhes consolidados da nota
      const primeiro = bipes[0];
      const ultimo = bipes[bipes.length - 1];
      const badgeTipo = primeiro.tipo === 'TRANSFERENCIA' ? 'badge-transferencia' : 'badge-compra';

      let timelineHtml = '';
      bipes.forEach(b => {
        const dataFormatada = new Date(b.bipado_em).toLocaleString('pt-BR');
        timelineHtml += `
          <div class="timeline-item">
            <div class="timeline-ponto"></div>
            <div class="timeline-conteudo">
              <div class="timeline-topo">
                <span class="badge badge-etapa">${b.etapa}</span>
                <span class="timeline-data">${dataFormatada}</span>
              </div>
              <div class="timeline-operador">Operador: <strong>${b.usuario_nome || 'Não informado'}</strong> (Unidade: ${b.unidade || 'Matriz'})</div>
              ${b.alerta ? `<div class="timeline-alerta">⚠ ${b.alerta}</div>` : ''}
            </div>
          </div>
        `;
      });

      resultadoConsulta.innerHTML = `
        <div class="card-resultado-consulta">
          <div class="consulta-header">
            <div>
              <h2 class="consulta-titulo">NF ${primeiro.numero_nf || 'S/N'} <span class="badge ${badgeTipo}">${primeiro.tipo}</span></h2>
              <p class="consulta-subtitulo">Emitente: <strong>${primeiro.nome_emitente || 'Não cadastrado'}</strong> (${formatarCnpj(primeiro.cnpj_emitente)})</p>
            </div>
            <div class="consulta-meta">
              <div>Série: <strong>${primeiro.serie || '1'}</strong></div>
              <div>UF: <strong>${campos ? campos.uf : 'SP'}</strong></div>
              <div>Emissão: <strong>${campos ? campos.mesAno : '-'}</strong></div>
            </div>
          </div>
          <div class="consulta-chave-completa">
            <span class="rotulo">Chave:</span> <code>${formatarChave(chave)}</code>
          </div>
          <h3 class="consulta-timeline-titulo">Linha do Tempo de Bipes</h3>
          <div class="timeline-container">
            ${timelineHtml}
          </div>
        </div>
      `;
    } catch (e) {
      resultadoConsulta.innerHTML = `<div class="text-danger py-4">Erro na consulta: ${e.message}</div>`;
    }
  }

  if (btnBuscar) btnBuscar.addEventListener('click', executarConsulta);
  if (inputConsulta) {
    inputConsulta.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executarConsulta();
      }
    });
  }
}
