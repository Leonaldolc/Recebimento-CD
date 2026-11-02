/**
 * validacao.js
 * Funções puras de validação, cálculo de DV e classificação de chaves de NF-e (44 dígitos).
 * Compatível com navegadores ES2017+ e ambientes Node.js.
 */

/**
 * Remove qualquer caractere que não seja dígito numérico e remove espaços.
 * @param {string} str 
 * @returns {string}
 */
export function limparChave(str) {
  if (!str) return '';
  return String(str).replace(/\D/g, '').trim();
}

/**
 * Formata um CNPJ de 14 dígitos no padrão XX.XXX.XXX/XXXX-XX.
 * @param {string} cnpj 
 * @returns {string}
 */
export function formatarCnpj(cnpj) {
  const limpo = limparChave(cnpj);
  if (limpo.length !== 14) return cnpj || '';
  return limpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

/**
 * Formata uma chave de 44 dígitos em blocos de 4 dígitos para fácil leitura.
 * @param {string} chave 
 * @returns {string}
 */
export function formatarChave(chave) {
  const limpa = limparChave(chave);
  if (limpa.length !== 44) return chave || '';
  return limpa.replace(/(\d{4})/g, '$1 ').trim();
}

/**
 * Extrai os campos individuais da chave de acesso de 44 dígitos da NF-e.
 * Posições (base 1):
 * 01-02: UF
 * 03-06: AAMM
 * 07-20: CNPJ do Emitente
 * 21-22: Modelo (55 = NF-e, 57 = CT-e, 65 = NFC-e)
 * 23-25: Série
 * 26-34: Número da NF
 * 35-35: Tipo de Emissão
 * 36-43: Código Numérico
 * 44-44: Dígito Verificador (DV)
 * @param {string} chave - 44 dígitos
 */
export function extrairCampos(chave) {
  const c = limparChave(chave);
  if (c.length !== 44) return null;

  const numBruto = c.substring(25, 34);
  const numFormatado = String(parseInt(numBruto, 10)); // remove zeros à esquerda
  const serieBruta = c.substring(22, 25);
  const serieFormatada = String(parseInt(serieBruta, 10));

  return {
    chave: c,
    uf: c.substring(0, 2),
    aamm: c.substring(2, 6),
    mesAno: c.substring(4, 6) + '/' + '20' + c.substring(2, 4),
    cnpjEmitente: c.substring(6, 20),
    modelo: c.substring(20, 22),
    serie: serieFormatada,
    serieCompleta: serieBruta,
    numeroNf: numFormatado,
    numeroNfCompleto: numBruto,
    tipoEmissao: c.substring(34, 35),
    codigoNumerico: c.substring(35, 43),
    dv: c.substring(43, 44)
  };
}

/**
 * Valida o Dígito Verificador (DV) da chave de 44 dígitos pelo algoritmo Módulo 11.
 * Pesos de 2 a 9 da direita para a esquerda sobre os primeiros 43 dígitos.
 * @param {string} chave 
 * @returns {boolean}
 */
export function dvValido(chave) {
  const c = limparChave(chave);
  if (c.length !== 44) return false;

  const base43 = c.substring(0, 43);
  const dvInformado = parseInt(c.charAt(43), 10);
  if (isNaN(dvInformado)) return false;

  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  let pesoIndex = 0;

  // Percorre os 43 dígitos de trás para frente (da direita para a esquerda)
  for (let i = base43.length - 1; i >= 0; i--) {
    const digito = parseInt(base43.charAt(i), 10);
    soma += digito * pesos[pesoIndex % 8];
    pesoIndex++;
  }

  const resto = soma % 11;
  const dvCalculado = resto < 2 ? 0 : 11 - resto;

  return dvCalculado === dvInformado;
}

/**
 * Realiza a validação completa da chave bruta conforme regras 1, 2 e 3 da seção 5.
 * @param {string} chaveBruta 
 * @returns {{
 *   valido: boolean,
 *   erro: string|null,
 *   aviso: string|null,
 *   chave: string,
 *   campos: object|null
 * }}
 */
export function validarChave(chaveBruta) {
  const chave = limparChave(chaveBruta);

  // Regra 1: Formato exatamente 44 dígitos numéricos
  if (!chave || chave.length !== 44) {
    return {
      valido: false,
      erro: 'Chave inválida. Bipe novamente.',
      aviso: null,
      chave: chave,
      campos: null
    };
  }

  // Regra 2: Dígito Verificador Módulo 11
  if (!dvValido(chave)) {
    return {
      valido: false,
      erro: 'Leitura incorreta (dígito verificador). Bipe novamente.',
      aviso: null,
      chave: chave,
      campos: null
    };
  }

  const campos = extrairCampos(chave);

  // Regra 3: Modelo NF-e (se diferente de 55, aviso laranja, mas permite gravação)
  let aviso = null;
  if (campos && campos.modelo !== '55') {
    aviso = 'Modelo ' + campos.modelo + ' (não é NF-e 55)';
  }

  return {
    valido: true,
    erro: null,
    aviso: aviso,
    chave: chave,
    campos: campos
  };
}

/**
 * Classifica a nota fiscal em COMPRA ou TRANSFERÊNCIA pelo CNPJ emitente.
 * Se o CNPJ constar na lista de centros cadastrados -> TRANSFERENCIA
 * Caso contrário -> COMPRA (nome do fornecedor cadastrado ou CNPJ formatado + 'fora da lista')
 * 
 * @param {string} cnpjEmitente - 14 dígitos numéricos
 * @param {Map<string, string>|Object<string, string>|Set<string>|Array<string>} centros 
 * @param {Map<string, string>|Object<string, string>} fornecedores 
 * @returns {{ tipo: 'COMPRA'|'TRANSFERENCIA', nomeEmitente: string, cadastrado: boolean }}
 */
export function classificar(cnpjEmitente, centros, fornecedores) {
  const cnpj = limparChave(cnpjEmitente);

  // Verificar se é centro
  let isCentro = false;
  let nomeCentro = '';

  if (centros instanceof Map) {
    if (centros.has(cnpj)) {
      isCentro = true;
      nomeCentro = centros.get(cnpj);
    }
  } else if (centros instanceof Set) {
    if (centros.has(cnpj)) {
      isCentro = true;
    }
  } else if (Array.isArray(centros)) {
    if (centros.indexOf(cnpj) !== -1) {
      isCentro = true;
    }
  } else if (centros && typeof centros === 'object') {
    if (Object.prototype.hasOwnProperty.call(centros, cnpj)) {
      isCentro = true;
      nomeCentro = centros[cnpj];
    }
  }

  if (isCentro) {
    return {
      tipo: 'TRANSFERENCIA',
      nomeEmitente: nomeCentro || 'Centro TK Elevator',
      cadastrado: true
    };
  }

  // É compra: buscar nome do fornecedor
  let nomeFornecedor = '';
  let cadastrado = false;

  if (fornecedores instanceof Map) {
    if (fornecedores.has(cnpj)) {
      nomeFornecedor = fornecedores.get(cnpj);
      cadastrado = true;
    }
  } else if (fornecedores && typeof fornecedores === 'object') {
    if (Object.prototype.hasOwnProperty.call(fornecedores, cnpj)) {
      nomeFornecedor = fornecedores[cnpj];
      cadastrado = true;
    }
  }

  if (cadastrado && nomeFornecedor) {
    return {
      tipo: 'COMPRA',
      nomeEmitente: nomeFornecedor,
      cadastrado: true
    };
  }

  return {
    tipo: 'COMPRA',
    nomeEmitente: formatarCnpj(cnpj) + ' (fora da lista)',
    cadastrado: false
  };
}
