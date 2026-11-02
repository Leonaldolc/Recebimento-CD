/**
 * cadastros.js
 * Módulo administrativo exclusivo para papel ADMIN:
 * 1. Centros e Fornecedores (listagem, cadastro manual, exclusão e importação em lote via CSV)
 * 2. Gestão de Usuários (liberar acesso, alterar papel e unidade)
 * 3. Configurações gerais (prazo de alerta em horas e limpeza de dados de teste)
 */
import { obterSupabase } from './auth.js';
import { formatarCnpj, limparChave } from './validacao.js';
import { carregarCachesCadastros } from './bipe.js';

let listaCentros = [];
let listaFornecedores = [];
let listaUsuarios = [];

/**
 * Carrega a lista de centros cadastrados.
 */
export async function carregarCentros() {
  const supabase = obterSupabase();
  if (!supabase) return;

  const corpo = document.getElementById('tabela-centros-corpo');
  if (corpo) corpo.innerHTML = '<tr><td colspan="4" class="text-center py-4">Carregando centros...</td></tr>';

  try {
    const { data, error } = await supabase
      .from('centros')
      .select('*')
      .order('nome', { ascending: true });

    if (error) throw error;
    listaCentros = data || [];
    renderizarTabelaCentros();
  } catch (e) {
    console.error('Erro ao buscar centros:', e);
    if (corpo) corpo.innerHTML = `<tr><td colspan="4" class="text-danger py-4">Erro: ${e.message}</td></tr>`;
  }
}

function renderizarTabelaCentros() {
  const corpo = document.getElementById('tabela-centros-corpo');
  if (!corpo) return;

  if (listaCentros.length === 0) {
    corpo.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Nenhum centro cadastrado ainda.</td></tr>';
    return;
  }

  let html = '';
  listaCentros.forEach(c => {
    html += `
      <tr>
        <td><strong>${formatarCnpj(c.cnpj)}</strong></td>
        <td>${c.nome}</td>
        <td class="text-right">
          <button class="btn-acao btn-excluir" data-cnpj="${c.cnpj}" data-tipo="centro">Excluir</button>
        </td>
      </tr>
    `;
  });

  corpo.innerHTML = html;

  corpo.querySelectorAll('button[data-tipo="centro"]').forEach(btn => {
    btn.addEventListener('click', async function() {
      const cnpj = this.getAttribute('data-cnpj');
      if (confirm(`Deseja remover o centro com CNPJ ${formatarCnpj(cnpj)}?`)) {
        await excluirRegistro('centros', cnpj);
        await carregarCentros();
        await carregarCachesCadastros();
      }
    });
  });
}

/**
 * Carrega a lista de fornecedores com filtro de busca.
 */
export async function carregarFornecedores() {
  const supabase = obterSupabase();
  if (!supabase) return;

  const corpo = document.getElementById('tabela-fornecedores-corpo');
  if (corpo) corpo.innerHTML = '<tr><td colspan="4" class="text-center py-4">Carregando fornecedores...</td></tr>';

  try {
    const { data, error } = await supabase
      .from('fornecedores')
      .select('*')
      .order('nome', { ascending: true })
      .limit(500);

    if (error) throw error;
    listaFornecedores = data || [];
    renderizarTabelaFornecedores();
  } catch (e) {
    console.error('Erro ao buscar fornecedores:', e);
    if (corpo) corpo.innerHTML = `<tr><td colspan="4" class="text-danger py-4">Erro: ${e.message}</td></tr>`;
  }
}

function renderizarTabelaFornecedores() {
  const corpo = document.getElementById('tabela-fornecedores-corpo');
  const termo = (document.getElementById('busca-fornecedor')?.value || '').toLowerCase().trim();
  if (!corpo) return;

  const filtrados = listaFornecedores.filter(f => {
    if (!termo) return true;
    return f.cnpj.indexOf(termo) !== -1 || f.nome.toLowerCase().indexOf(termo) !== -1;
  });

  if (filtrados.length === 0) {
    corpo.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Nenhum fornecedor encontrado.</td></tr>';
    return;
  }

  let html = '';
  filtrados.slice(0, 100).forEach(f => {
    html += `
      <tr>
        <td><strong>${formatarCnpj(f.cnpj)}</strong></td>
        <td>${f.nome}</td>
        <td class="text-right">
          <button class="btn-acao btn-excluir" data-cnpj="${f.cnpj}" data-tipo="fornecedor">Excluir</button>
        </td>
      </tr>
    `;
  });

  if (filtrados.length > 100) {
    html += `<tr><td colspan="4" class="text-center text-muted py-2">Exibindo 100 de ${filtrados.length} fornecedores. Use a busca para filtrar.</td></tr>`;
  }

  corpo.innerHTML = html;

  corpo.querySelectorAll('button[data-tipo="fornecedor"]').forEach(btn => {
    btn.addEventListener('click', async function() {
      const cnpj = this.getAttribute('data-cnpj');
      if (confirm(`Deseja remover o fornecedor com CNPJ ${formatarCnpj(cnpj)}?`)) {
        await excluirRegistro('fornecedores', cnpj);
        await carregarFornecedores();
        await carregarCachesCadastros();
      }
    });
  });
}

/**
 * Adiciona um registro único de centro ou fornecedor.
 * @param {'centros'|'fornecedores'} tabela 
 * @param {string} cnpjBruto 
 * @param {string} nome 
 */
export async function adicionarRegistro(tabela, cnpjBruto, nome) {
  const supabase = obterSupabase();
  if (!supabase) return { sucesso: false, erro: 'Sem conexão com banco.' };

  const cnpjLimpo = limparChave(cnpjBruto);
  if (cnpjLimpo.length !== 14) {
    return { sucesso: false, erro: 'CNPJ deve conter exatamente 14 dígitos numéricos.' };
  }
  if (!nome || !nome.trim()) {
    return { sucesso: false, erro: 'Informe o nome ou razão social.' };
  }

  try {
    // Obter empresa_id do perfil atual
    const { data: perfil } = await supabase.from('perfis').select('empresa_id').eq('id', (await supabase.auth.getUser()).data.user.id).single();
    if (!perfil) return { sucesso: false, erro: 'Perfil não encontrado.' };

    const { error } = await supabase
      .from(tabela)
      .upsert({
        empresa_id: perfil.empresa_id,
        cnpj: cnpjLimpo,
        nome: nome.trim()
      }, { onConflict: 'empresa_id,cnpj' });

    if (error) throw error;
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

/**
 * Exclui um registro de centro ou fornecedor pelo CNPJ.
 */
async function excluirRegistro(tabela, cnpj) {
  const supabase = obterSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase.from(tabela).delete().eq('cnpj', cnpj);
    if (error) alert('Erro ao excluir: ' + error.message);
  } catch (e) {
    alert('Erro ao excluir: ' + e.message);
  }
}

/**
 * Importa múltiplos registros a partir de texto CSV ou arquivo.
 * Formato aceito: cnpj;nome ou cnpj,nome (com ou sem pontuação no CNPJ).
 * @param {'centros'|'fornecedores'} tabela 
 * @param {string} conteudoCsv 
 */
export async function importarCsv(tabela, conteudoCsv) {
  const supabase = obterSupabase();
  if (!supabase) return { sucesso: false, erro: 'Sem conexão.' };

  const { data: authData } = await supabase.auth.getUser();
  if (!authData || !authData.user) return { sucesso: false, erro: 'Usuário não autenticado.' };

  const { data: perfil } = await supabase.from('perfis').select('empresa_id').eq('id', authData.user.id).single();
  if (!perfil) return { sucesso: false, erro: 'Perfil não encontrado.' };

  const linhas = conteudoCsv.split(/\r?\n/);
  const registros = [];

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i].trim();
    if (!linha) continue;

    // Detectar separador (ponto-e-vírgula ou vírgula ou tab)
    let partes = linha.split(';');
    if (partes.length < 2) partes = linha.split(',');
    if (partes.length < 2) partes = linha.split('\t');

    if (partes.length >= 2) {
      const cnpjCru = partes[0].replace(/"/g, '').trim();
      const nomeCru = partes.slice(1).join(' ').replace(/"/g, '').trim();

      // Ignora linha de cabeçalho
      if (cnpjCru.toLowerCase().indexOf('cnpj') !== -1) continue;

      const cnpjLimpo = limparChave(cnpjCru);
      if (cnpjLimpo.length === 14 && nomeCru.length > 0) {
        registros.push({
          empresa_id: perfil.empresa_id,
          cnpj: cnpjLimpo,
          nome: nomeCru
        });
      }
    }
  }

  if (registros.length === 0) {
    return { sucesso: false, erro: 'Nenhuma linha válida encontrada no CSV. Use o formato: cnpj;nome' };
  }

  try {
    // Upsert em lotes de 50 para máxima confiabilidade
    const tamanhoLote = 50;
    for (let i = 0; i < registros.length; i += tamanhoLote) {
      const lote = registros.slice(i, i + tamanhoLote);
      const { error } = await supabase
        .from(tabela)
        .upsert(lote, { onConflict: 'empresa_id,cnpj' });

      if (error) throw error;
    }

    return { sucesso: true, quantidade: registros.length };
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

/**
 * Carrega a lista de usuários da empresa para gestão de acesso.
 */
export async function carregarUsuarios() {
  const supabase = obterSupabase();
  if (!supabase) return;

  const corpo = document.getElementById('tabela-usuarios-corpo');
  if (corpo) corpo.innerHTML = '<tr><td colspan="6" class="text-center py-4">Carregando usuários...</td></tr>';

  try {
    const { data, error } = await supabase
      .from('perfis')
      .select('*')
      .order('criado_em', { ascending: false });

    if (error) throw error;
    listaUsuarios = data || [];
    renderizarTabelaUsuarios();
  } catch (e) {
    console.error('Erro ao buscar usuários:', e);
    if (corpo) corpo.innerHTML = `<tr><td colspan="6" class="text-danger py-4">Erro: ${e.message}</td></tr>`;
  }
}

function renderizarTabelaUsuarios() {
  const corpo = document.getElementById('tabela-usuarios-corpo');
  if (!corpo) return;

  if (listaUsuarios.length === 0) {
    corpo.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Nenhum usuário cadastrado.</td></tr>';
    return;
  }

  let html = '';
  listaUsuarios.forEach(u => {
    const statusBadge = u.ativo
      ? '<span class="badge badge-sucesso">ATIVO</span>'
      : '<span class="badge badge-perigo">INATIVO (Aguardando)</span>';

    html += `
      <tr data-user-id="${u.id}">
        <td><strong>${u.nome || '-'}</strong></td>
        <td>${u.email}</td>
        <td>
          <select class="select-tabela select-usuario-papel" data-id="${u.id}">
            <option value="RECEBIMENTO" ${u.papel === 'RECEBIMENTO' ? 'selected' : ''}>RECEBIMENTO</option>
            <option value="FISCAL" ${u.papel === 'FISCAL' ? 'selected' : ''}>FISCAL</option>
            <option value="ADMIN" ${u.papel === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
          </select>
        </td>
        <td>
          <input type="text" class="input-tabela input-usuario-unidade" data-id="${u.id}" value="${u.unidade || ''}" placeholder="Ex: 5061">
        </td>
        <td>${statusBadge}</td>
        <td class="text-right">
          <button class="btn-acao ${u.ativo ? 'btn-desativar' : 'btn-ativar'}" data-id="${u.id}" data-ativo="${u.ativo}">
            ${u.ativo ? 'Desativar' : 'Liberar Acesso'}
          </button>
        </td>
      </tr>
    `;
  });

  corpo.innerHTML = html;

  // Ouvintes para ativar/desativar
  corpo.querySelectorAll('.btn-ativar, .btn-desativar').forEach(btn => {
    btn.addEventListener('click', async function() {
      const id = this.getAttribute('data-id');
      const ativoAtual = this.getAttribute('data-ativo') === 'true';
      await atualizarUsuario(id, { ativo: !ativoAtual });
      await carregarUsuarios();
    });
  });

  // Ouvintes para mudança de papel
  corpo.querySelectorAll('.select-usuario-papel').forEach(sel => {
    sel.addEventListener('change', async function() {
      const id = this.getAttribute('data-id');
      await atualizarUsuario(id, { papel: this.value });
    });
  });

  // Ouvintes para mudança de unidade ao perder o foco (blur)
  corpo.querySelectorAll('.input-usuario-unidade').forEach(inp => {
    inp.addEventListener('blur', async function() {
      const id = this.getAttribute('data-id');
      await atualizarUsuario(id, { unidade: this.value.trim() });
    });
  });
}

async function atualizarUsuario(userId, campos) {
  const supabase = obterSupabase();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('perfis')
      .update(campos)
      .eq('id', userId);

    if (error) alert('Erro ao atualizar usuário: ' + error.message);
  } catch (e) {
    alert('Erro ao atualizar usuário: ' + e.message);
  }
}

/**
 * Salva as horas de alerta padrão nas configurações.
 * @param {number} horas 
 */
export async function salvarHorasAlerta(horas) {
  const supabase = obterSupabase();
  if (!supabase) return { sucesso: false, erro: 'Sem conexão.' };

  try {
    const { data: authData } = await supabase.auth.getUser();
    const { data: perfil } = await supabase.from('perfis').select('empresa_id').eq('id', authData.user.id).single();

    const { error } = await supabase
      .from('configuracoes')
      .upsert({
        empresa_id: perfil.empresa_id,
        horas_alerta: horas,
        atualizado_em: new Date().toISOString()
      }, { onConflict: 'empresa_id' });

    if (error) throw error;
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

/**
 * Limpa todos os bipes de teste (ADMIN apenas).
 */
export async function limparDadosTeste() {
  const supabase = obterSupabase();
  if (!supabase) return { sucesso: false, erro: 'Sem conexão.' };

  const confirma1 = confirm('ATENÇÃO: Isso excluirá permanentemente todos os registros de bipes de teste gravados no sistema. Deseja continuar?');
  if (!confirma1) return { sucesso: false, cancelado: true };

  const confirma2 = prompt('Para confirmar a exclusão de todos os bipes, digite LIMPAR:');
  if (confirma2 !== 'LIMPAR') {
    alert('Operação cancelada. A palavra de confirmação não confere.');
    return { sucesso: false, cancelado: true };
  }

  try {
    const { error } = await supabase.rpc('limpar_dados_teste');
    if (error) throw error;
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

/**
 * Inicializa todos os botões e formulários da tela de cadastros.
 */
export function inicializarEventosCadastros() {
  // Sub-abas de cadastros
  document.querySelectorAll('.tab-cadastro').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.tab-cadastro').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.secao-cadastro').forEach(s => s.classList.remove('active'));

      this.classList.add('active');
      const targetId = this.getAttribute('data-tab');
      const secao = document.getElementById(targetId);
      if (secao) secao.classList.add('active');
    });
  });

  // Cadastro manual de centro
  const formCentro = document.getElementById('form-add-centro');
  if (formCentro) {
    formCentro.addEventListener('submit', async function(e) {
      e.preventDefault();
      const cnpj = document.getElementById('add-centro-cnpj').value;
      const nome = document.getElementById('add-centro-nome').value;
      const res = await adicionarRegistro('centros', cnpj, nome);
      if (res.sucesso) {
        formCentro.reset();
        await carregarCentros();
        await carregarCachesCadastros();
        alert('Centro cadastrado com sucesso!');
      } else {
        alert('Erro: ' + res.erro);
      }
    });
  }

  // Cadastro manual de fornecedor
  const formForn = document.getElementById('form-add-fornecedor');
  if (formForn) {
    formForn.addEventListener('submit', async function(e) {
      e.preventDefault();
      const cnpj = document.getElementById('add-fornecedor-cnpj').value;
      const nome = document.getElementById('add-fornecedor-nome').value;
      const res = await adicionarRegistro('fornecedores', cnpj, nome);
      if (res.sucesso) {
        formForn.reset();
        await carregarFornecedores();
        await carregarCachesCadastros();
        alert('Fornecedor cadastrado com sucesso!');
      } else {
        alert('Erro: ' + res.erro);
      }
    });
  }

  // Busca de fornecedores em tempo real
  const inputBusca = document.getElementById('busca-fornecedor');
  if (inputBusca) {
    inputBusca.addEventListener('input', renderizarTabelaFornecedores);
  }

  // Modal / Importação CSV
  const btnAbrirModal = document.getElementById('btn-abrir-importar-csv');
  const modalCsv = document.getElementById('modal-importar-csv');
  const btnFecharModal = document.getElementById('btn-fechar-modal-csv');
  const btnProcessarCsv = document.getElementById('btn-processar-importacao-csv');
  const fileInputCsv = document.getElementById('arquivo-csv-input');
  const textareaCsv = document.getElementById('texto-csv-input');

  if (btnAbrirModal && modalCsv) {
    btnAbrirModal.addEventListener('click', () => { modalCsv.style.display = 'flex'; });
  }
  if (btnFecharModal && modalCsv) {
    btnFecharModal.addEventListener('click', () => { modalCsv.style.display = 'none'; });
  }

  if (fileInputCsv && textareaCsv) {
    fileInputCsv.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(evt) {
          textareaCsv.value = evt.target.result;
        };
        reader.readAsText(file, 'UTF-8');
      }
    });
  }

  if (btnProcessarCsv && textareaCsv) {
    btnProcessarCsv.addEventListener('click', async function() {
      const tipo = document.getElementById('select-tipo-csv-destino').value;
      const texto = textareaCsv.value;
      if (!texto.trim()) {
        alert('Cole o texto CSV ou selecione um arquivo.');
        return;
      }

      btnProcessarCsv.disabled = true;
      btnProcessarCsv.innerText = 'Importando...';

      const res = await importarCsv(tipo, texto);
      btnProcessarCsv.disabled = false;
      btnProcessarCsv.innerText = 'Iniciar Importação';

      if (res.sucesso) {
        alert(`Sucesso! ${res.quantidade} registros importados/atualizados em ${tipo}.`);
        modalCsv.style.display = 'none';
        textareaCsv.value = '';
        if (fileInputCsv) fileInputCsv.value = '';
        if (tipo === 'centros') await carregarCentros();
        else await carregarFornecedores();
        await carregarCachesCadastros();
      } else {
        alert('Erro na importação: ' + res.erro);
      }
    });
  }

  // Salvar Horas de Alerta
  const btnSalvarHoras = document.getElementById('btn-salvar-horas-config');
  const inputHorasConfig = document.getElementById('input-config-horas-alerta');
  if (btnSalvarHoras && inputHorasConfig) {
    btnSalvarHoras.addEventListener('click', async function() {
      const h = parseInt(inputHorasConfig.value, 10);
      if (isNaN(h) || h < 1) {
        alert('Informe um número válido de horas (mínimo 1).');
        return;
      }
      const res = await salvarHorasAlerta(h);
      if (res.sucesso) {
        alert('Configuração de prazo de alerta salva com sucesso!');
      } else {
        alert('Erro ao salvar: ' + res.erro);
      }
    });
  }

  // Limpar dados de teste
  const btnLimparTestes = document.getElementById('btn-limpar-dados-teste');
  if (btnLimparTestes) {
    btnLimparTestes.addEventListener('click', async function() {
      const res = await limparDadosTeste();
      if (res.sucesso) {
        alert('Todos os registros de bipes de teste foram excluídos com sucesso.');
        window.location.hash = '#bipar';
        window.location.reload();
      } else if (!res.cancelado) {
        alert('Erro ao limpar testes: ' + res.erro);
      }
    });
  }
}
