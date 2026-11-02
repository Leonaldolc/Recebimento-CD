"""
Script de linha de comando para testar a lógica de validação da NF-e, DV e regras de classificação.
"""
import re

def limpar_chave(s):
    if not s:
        return ""
    return re.sub(r'\D', '', str(s)).strip()

def formatar_cnpj(cnpj):
    c = limpar_chave(cnpj)
    if len(c) != 14:
        return cnpj or ""
    return f"{c[0:2]}.{c[2:5]}.{c[5:8]}/{c[8:12]}-{c[12:14]}"

def extrair_campos(chave):
    c = limpar_chave(chave)
    if len(c) != 44:
        return None
    return {
        "chave": c,
        "uf": c[0:2],
        "aamm": c[2:6],
        "cnpj_emitente": c[6:20],
        "modelo": c[20:22],
        "serie": str(int(c[22:25])),
        "numero_nf": str(int(c[25:34])),
        "dv": c[43:44]
    }

def dv_valido(chave):
    c = limpar_chave(chave)
    if len(c) != 44:
        return False
    base43 = c[:43]
    try:
        dv_informado = int(c[43])
    except ValueError:
        return False

    pesos = [2, 3, 4, 5, 6, 7, 8, 9]
    soma = 0
    for i, char in enumerate(reversed(base43)):
        soma += int(char) * pesos[i % 8]

    resto = soma % 11
    dv_calculado = 0 if resto < 2 else 11 - resto
    return dv_calculado == dv_informado

def classificar(cnpj_emitente, centros, fornecedores):
    cnpj = limpar_chave(cnpj_emitente)
    if cnpj in centros:
        return {"tipo": "TRANSFERENCIA", "nome": centros[cnpj]}
    if cnpj in fornecedores:
        return {"tipo": "COMPRA", "nome": fornecedores[cnpj]}
    return {"tipo": "COMPRA", "nome": f"{formatar_cnpj(cnpj)} (fora da lista)"}

def main():
    print("=" * 60)
    print("EXECUTANDO TESTES DE VALIDAÇÃO E REGRAS DE NEGÓCIO DA NF-e")
    print("=" * 60)

    testes = []

    # 1. Chaves de teste especificadas
    k_compra = '35261111222333000181550010000123451123456788'
    k_transf = '35261111444777000161550010000543211123456780'
    k_dv_err = '35261111222333000181550010000123451123456789'

    testes.append(("DV Chave Compra válida (DV=8)", dv_valido(k_compra) == True))
    testes.append(("DV Chave Transferência válida (DV=0)", dv_valido(k_transf) == True))
    testes.append(("DV Chave com DV Inválido rejeitada (DV=9)", dv_valido(k_dv_err) == False))
    testes.append(("Rejeita chave menor de 44 dígitos", dv_valido(k_compra[:43]) == False))

    campos = extrair_campos(k_compra)
    testes.append(("Extração UF (35)", campos["uf"] == "35"))
    testes.append(("Extração CNPJ (11222333000181)", campos["cnpj_emitente"] == "11222333000181"))
    testes.append(("Extração Modelo (55)", campos["modelo"] == "55"))
    testes.append(("Extração Série (1)", campos["serie"] == "1"))
    testes.append(("Extração Número NF (12345)", campos["numero_nf"] == "12345"))

    centros = {"11444777000161": "Centro SP 5061"}
    fornecedores = {"11222333000181": "Metalúrgica Fornecedor SA"}

    cls_t = classificar("11444777000161", centros, fornecedores)
    testes.append(("Classificação TRANSFERENCIA", cls_t["tipo"] == "TRANSFERENCIA"))

    cls_c = classificar("11222333000181", centros, fornecedores)
    testes.append(("Classificação COMPRA cadastrada", cls_c["tipo"] == "COMPRA" and "Metalúrgica" in cls_c["nome"]))

    cls_f = classificar("99888777000199", centros, fornecedores)
    testes.append(("Classificação COMPRA fora da lista", cls_f["tipo"] == "COMPRA" and "fora da lista" in cls_f["nome"]))

    aprovados = 0
    for nome, passou in testes:
        status = "[PASSOU]" if passou else "[FALHOU]"
        if passou:
            aprovados += 1
        print(f"{status:10} {nome}")

    print("-" * 60)
    print(f"Resultado: {aprovados}/{len(testes)} testes aprovados.")
    print("=" * 60)

    if aprovados != len(testes):
        exit(1)

if __name__ == "__main__":
    main()
