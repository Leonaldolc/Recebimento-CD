# Chaves de Teste e Roteiro de Aceitação — Chave da NF

Este documento contém as chaves de teste oficiais para validação do aplicativo **Chave da NF**, com os Dígitos Verificadores (DV) já calculados e conferidos matematicamente (Módulo 11), além do roteiro de testes passo a passo.

---

## 1. Chaves de Teste Prontas

| Tipo | Chave de Acesso (44 dígitos) | CNPJ Emitente | Modelo | Número NF | Série | DV |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Compra Válida** | `35261111222333000181550010000123451123456788` | `11.222.333/0001-81` | 55 | 12345 | 1 | 8 |
| **2. Transferência Válida** | `35261111444777000161550010000543211123456780` | `11.444.777/0001-61` | 55 | 54321 | 1 | 0 |
| **3. DV Inválido** | `35261111222333000181550010000123451123456789` | `11.222.333/0001-81` | 55 | 12345 | 1 | 9 *(errado)* |
| **4. CT-e (Modelo 57)** | `35261111222333000181570010000123451123456781` | `11.222.333/0001-81` | 57 | 12345 | 1 | 1 |

> **Nota prévia:**
> - Cadastre o CNPJ `11.444.777/0001-61` em **Cadastros → Centros** com o nome "Centro de Distribuição SP 5061".
> - Cadastre o CNPJ `11.222.333/0001-81` em **Cadastros → Fornecedores** com o nome "Fornecedor Teste Peças SA".

---

## 2. Roteiro de Testes de Aceitação

Siga estes passos na ordem para validar todas as regras do sistema:

### Teste 1: Bipe de Compra (Recebimento) e Duplicidade
1. Entre com usuário de papel **RECEBIMENTO** (ou **ADMIN** com etapa "RECEBIMENTO").
2. Bipe a chave **1 (Compra)**: `35261111222333000181550010000123451123456788`.
   - **Resultado esperado:** Banner **VERDE**, tipo **COMPRA**, emitente identificado, som de confirmação e vibração rápida. Contador do dia incrementa.
3. Bipe a **mesma chave novamente** no Recebimento.
   - **Resultado esperado:** Banner **LARANJA** avisando: *"Essa nota já foi bipada nesta etapa por [Seu Nome] às [HH:MM]"*. O sistema **não grava duplicado**.

### Teste 2: Bipe no Fiscal e Resolução de Pendência
1. Mude para usuário de papel **FISCAL** (ou selecione etapa "FISCAL" como ADMIN).
2. Vá na tela **Pendências**: a chave da compra deve estar listada em *"Perdida entre recebimento e fiscal"* (se o filtro de horas estiver em 0h ou após o prazo).
3. Vá na tela **Bipar** e bipe a chave **1 (Compra)**.
   - **Resultado esperado:** Banner **VERDE**, gravado com sucesso na etapa FISCAL.
4. Volte à tela **Pendências**: a nota **desapareceu** da lista de pendências, pois o ciclo do fiscal foi concluído.

### Teste 3: Transferência entre Centros (Recebimento)
1. Com papel **RECEBIMENTO**, bipe a chave **2 (Transferência)**: `35261111444777000161550010000543211123456780`.
   - **Resultado esperado:** Banner **VERDE**, classificado automaticamente como **TRANSFERÊNCIA** e exibindo o nome do centro cadastrado.
2. Na tela **Pendências**, com o filtro de horas zerado, ela aparecerá em *"Transferência sem entrada dada"*.

### Teste 4: Modo ENTRADA (Transferência vs Compra)
1. Na tela de Bipe, clique no botão **"Dar entrada (transferência)"**.
   - O cabeçalho fica destacado em destaque roxo/âmbar com a mensagem *"MODO ENTRADA ATIVO — Toque para sair"*.
2. Bipe primeiro a chave **1 (Compra)**:
   - **Resultado esperado:** Banner **VERMELHO** com som de erro: *"Entrada só é permitida para notas de Transferência (emitidas por centros internos)"*. Nada é gravado.
3. Agora bipe a chave **2 (Transferência)**:
   - **Resultado esperado:** Banner **VERDE** confirmando *"Entrada registrada com sucesso"*.
4. Clique no botão de modo entrada para desativá-lo. Na tela **Pendências**, a pendência de transferência é finalizada.

### Teste 5: Transferência no Fiscal (Regra de Exceção)
1. No papel **FISCAL**, bipe a chave **2 (Transferência)**.
   - **Resultado esperado:** Banner **LARANJA** avisando: *"Transferência normalmente não passa pelo fiscal"*, porém a gravação é **efetuada** com a marcação de alerta `FISCAL_EM_TRANSFERENCIA`.

### Teste 6: Dígito Verificador Inválido (Prevenção de Leitura Truncada)
1. Bipe a chave **3 (DV Inválido)**: `35261111222333000181550010000123451123456789`.
   - **Resultado esperado:** Banner **VERMELHO** imediato: *"Leitura incorreta (dígito verificador). Bipe novamente."* Nenhuma gravação no banco. Vibração dupla de erro e som grave.

### Teste 7: Restrições de Perfil (Segurança e RLS)
1. Com usuário de papel **RECEBIMENTO**:
   - A aba **Cadastros** nem sequer aparece no menu de navegação.
   - Não há opção de excluir bipes.
   - Qualquer tentativa de chamada direta à API do Supabase para alterar tabelas é rejeitada pelo banco (Row Level Security).

### Teste 8: Modo Offline e Reconexão
1. Desconecte o Wi-Fi do computador/celular ou ligue o Modo Avião.
2. O indicador no topo mudará para **OFFLINE** (vermelho/âmbar).
3. Bipe uma nova nota válida (ou a chave 1 em outra etapa):
   - O app valida o DV offline, armazena no aparelho (`localStorage`) e exibe o badge *"1 pendente de envio"*.
4. Reconecte a internet:
   - O app detecta a rede automaticamente, sincroniza o bipe com o Supabase e zera o contador de pendências locais.

### Teste 9: Testes Automatizados no Navegador
1. Abra no navegador o arquivo `testes/validacao.test.html`.
2. Todos os testes devem exibir a tarja verde **APROVADO** (100% de taxa de acerto).
