# 📦 Chave da NF — Guia Completo Passo a Passo

> **Olá, Leonaldo!** Este guia foi feito especialmente para você. Você não precisa saber programação para colocar o aplicativo no ar. Basta seguir as etapas numeradas abaixo, com calma, na ordem indicada.

---

## 📑 Sumário Rápido
1. [Criar conta e projeto no Supabase](#1-criar-conta-e-projeto-no-supabase)
2. [Executar o Banco de Dados no SQL Editor](#2-executar-o-banco-de-dados-no-sql-editor)
3. [Desligar a Confirmação de E-mail](#3-desligar-a-confirmação-de-e-mail)
4. [Copiar a URL e a Chave Pública para o config.js](#4-copiar-a-url-e-a-chave-pública-para-o-configjs)
5. [Publicar no GitHub Pages](#5-publicar-no-github-pages)
6. [Ajustar o Site URL no Supabase](#6-ajustar-o-site-url-no-supabase)
7. [Primeiro Acesso: Criar sua Conta de Administrador](#7-primeiro-acesso-criar-sua-conta-de-administrador)
8. [Cadastrar Centros e Fornecedores](#8-cadastrar-centros-e-fornecedores)
9. [Testar e Limpar Dados de Teste](#9-testar-e-limpar-dados-de-teste)
10. [Como Cadastrar e Liberar a Equipe](#10-como-cadastrar-e-liberar-a-equipe)
11. [Como Instalar no Celular ou Coletor de Dados](#11-como-instalar-no-celular-ou-coletor-de-dados)
12. [Solução de Problemas Comuns](#12-solução-de-problemas-comuns)
13. [Aviso Importante sobre Segurança](#13-aviso-importante-sobre-segurança)

---

## 1. Criar conta e projeto no Supabase

O **Supabase** é o servidor gratuito na nuvem onde os dados dos bipes ficam guardados.

1. Acesse o site oficial: [https://supabase.com](https://supabase.com).
2. Clique no botão verde **"Start your project"** e crie sua conta (você pode entrar com sua conta do GitHub ou com seu e-mail).
3. No painel inicial, clique em **"New project"** (Novo projeto).
4. Preencha os campos:
   - **Name:** `chave-da-nf`
   - **Database Password:** Escolha uma senha forte (anote num bloco de notas!).
   - **Region:** Selecione `South America (São Paulo)` para ter o menor tempo de resposta possível.
   - **Plan:** `Free` (Plano gratuito).
5. Clique em **"Create new project"** e aguarde cerca de 1 a 2 minutos até o painel terminar de inicializar.

---

## 2. Executar o Banco de Dados no SQL Editor

Agora vamos criar todas as tabelas e regras de segurança com um único clique:

1. No menu lateral esquerdo do Supabase, clique no ícone **SQL Editor** (o ícone se parece com um terminal `>_`).
2. Clique no botão verde **"New query"** (Nova consulta).
3. Abra em seu computador o arquivo `supabase/schema.sql` deste projeto, copie **todo o conteúdo** dele e cole dentro da janela preta do SQL Editor.
4. Clique no botão verde **"Run"** (no canto inferior direito da caixa de código) ou pressione `Ctrl + Enter`.
5. Você verá a mensagem **"Success. No rows returned"** em verde na parte inferior. Pronto! Todas as tabelas, regras RLS, permissões e gatilhos de primeiro usuário ADMIN foram criados.

---

## 3. Desligar a Confirmação de E-mail

No plano gratuito, o envio de e-mails tem limites baixos. Para o piloto da operação, é recomendado que os operadores entrem imediatamente sem precisar abrir a caixa de entrada para confirmar link:

1. No menu lateral esquerdo, clique no ícone **Authentication** (dois bonequinhos de usuário).
2. Clique no submenu **Providers** e depois em **Email**.
3. Localize a opção **"Confirm email"** e **desative a chavinha** (deixe em cinza / desligado).
4. Role até o final e clique no botão verde **"Save"**.

---

## 4. Copiar a URL e a Chave Pública para o config.js

1. No menu lateral esquerdo do Supabase, clique na engrenagem **Project Settings** (no rodapé esquerdo).
2. Clique na aba **API**.
3. Na seção **Project API keys**, você verá duas informações:
   - **Project URL:** Exemplo `https://abcdefghijk.supabase.co`
   - **Project API Keys → anon / public:** Uma sequência longa de letras e números que começa com `eyJh...`
4. Abra o arquivo [js/config.js](file:///c:/Users/RibeiroCarvalhoLeona/TK%20Elevator/dlog%20SP%20Capital%20-%20Documents/General/Chave%20NFs/js/config.js) no seu editor e substitua os valores:
   ```javascript
   export const SUPABASE_URL = 'https://seu-projeto.supabase.co';
   export const SUPABASE_ANON_KEY = 'sua-chave-anon-publica-aqui';
   ```
5. Salve o arquivo (`Ctrl + S`).

> ⚠️ **Atenção:** Nunca copie a chave `service_role`. Use apenas a chave **anon (public)**.

---

## 5. Publicar no seu Repositório do GitHub (Recebimento-CD)

Seu repositório já está criado em: **https://github.com/Leonaldolc/Recebimento-CD**

Para subir os arquivos do aplicativo de forma simples e rápida sem precisar de programas instalados:

### Opção Rápida pelo Navegador (Sem instalar nada):
1. Abra no seu navegador: **https://github.com/Leonaldolc/Recebimento-CD**
2. Clique no link azul **"uploading an existing file"** (ou no botão **"Add file" → "Upload files"**).
3. Selecione e arraste os arquivos e pastas deste projeto para a página:
   - `index.html`
   - `manifest.json`
   - `README.md`
   - pasta `css/`
   - pasta `icons/`
   - pasta `js/`
   - pasta `supabase/`
   - pasta `testes/`
4. Na parte inferior, clique no botão verde **"Commit changes"**.
5. Agora ative o **Pages**:
   - No topo do repositório, clique na aba **Settings** (com o ícone de engrenagem).
   - No menu lateral esquerdo, clique em **Pages**.
   - Em **Build and deployment → Branch**, mude de `None` para `main` e deixe a pasta como `/ (root)`.
   - Clique em **Save**.
6. Aguarde cerca de 1 a 2 minutos. O GitHub gerará o endereço oficial do seu aplicativo:
   👉 **`https://leonaldolc.github.io/Recebimento-CD/`**

---

## 6. Ajustar o Site URL no Supabase

1. Volte ao painel do seu projeto no Supabase.
2. No menu lateral esquerdo, clique em **Authentication → URL Configuration**.
3. No campo **Site URL**, cole o endereço exato do seu aplicativo:
   `https://leonaldolc.github.io/Recebimento-CD/`
4. Clique em **Save**.

---

## 7. Primeiro Acesso: Criar sua Conta de Administrador

> ⭐ **Regra de Ouro:** O **primeiro usuário** que se cadastrar no aplicativo se torna automaticamente o **ADMINISTRADOR ATIVO** da empresa.

1. Abra o link do seu site no navegador.
2. Clique em **"Não tem conta? Criar nova conta"**.
3. Digite o seu **Nome Completo**, seu **E-mail** e crie uma **Senha** (mínimo 6 dígitos).
4. Clique em **"Criar Conta"**.
5. Você entrará direto na tela principal com o selo vermelho **ADMIN** no topo!

---

## 8. Cadastrar Centros e Fornecedores

Antes de os operadores biparem, o sistema precisa saber quais CNPJs pertencem aos centros da empresa (para notas de transferência) e quais são de fornecedores (para notas de compra):

1. No menu superior, clique na aba **⚙ Cadastros**.
2. **Centros (Transferências internas):**
   - Na sub-aba "Centros", adicione manualmente o CNPJ e o nome dos seus centros de distribuição (Ex: `11.444.777/0001-61` - `Centro de Distribuição SP 5061`).
3. **Fornecedores (Compras):**
   - Na sub-aba "Fornecedores", você pode cadastrar um a um ou clicar em **"Importar Lista em CSV"**.
   - Você pode colar uma lista no formato `CNPJ;Nome` (o sistema aceita CNPJ com pontos ou sem pontos).
   - Se uma nota for bipada sem o fornecedor estar cadastrado, o sistema grava mesmo assim e exibe o CNPJ com o aviso *"fora da lista"*.

---

## 9. Testar e Limpar Dados de Teste

Abra o arquivo [testes/chaves-teste.md](file:///c:/Users/RibeiroCarvalhoLeona/TK%20Elevator/dlog%20SP%20Capital%20-%20Documents/General/Chave%20NFs/testes/chaves-teste.md) e siga os 9 passos do roteiro de testes:
- Bipar compra válida (verde).
- Bipar duplicidade (laranja).
- Bipar transferência (verde).
- Ligar modo entrada (roxo/vermelho).
- Bipar DV incorreto (vermelho).

Quando terminar de validar:
1. Vá em **⚙ Cadastros → Configurações Gerais**.
2. Na seção **Zona de Perigo**, clique em **"Limpar Bipes de Teste"**.
3. Digite a palavra `LIMPAR` para confirmar. Todos os bipes de teste serão apagados e seu sistema estará 100% zerado e pronto para o uso real da operação!

---

## 10. Como Cadastrar e Liberar a Equipe

1. Peça para cada operador ou fiscal abrir o site no celular/coletor e clicar em **"Criar nova conta"**.
2. Após criar a conta, ele verá a tela: **"⏳ Aguardando Liberação"**. Ele não consegue ver nenhuma nota até você liberar.
3. Você, como **ADMIN**:
   - Vá na aba **⚙ Cadastros → Usuários e Permissões**.
   - O novo operador aparecerá na lista como `INATIVO`.
   - Escolha o papel dele:
     - `RECEBIMENTO`: Equipe da doca/descarga.
     - `FISCAL`: Equipe de lançamento de notas.
   - Digite o código da **Unidade** dele (ex: `5061`).
   - Clique no botão verde **"Liberar Acesso"**.
4. O operador clica em **"Verificar Liberação"** no aparelho dele e o acesso é liberado instantaneamente.

---

## 11. Como Instalar no Celular ou Coletor de Dados

O aplicativo foi construído como PWA (Progressive Web App). Isso significa que você não precisa da Google Play Store:

### No Android / Coletor de Dados (Google Chrome):
1. Abra o site no Chrome do aparelho.
2. Toque nos **três pontinhos** no canto superior direito do navegador.
3. Toque em **"Adicionar à tela inicial"** ou **"Instalar aplicativo"**.
4. O ícone oficial do **Chave da NF** aparecerá na tela do aparelho como um aplicativo nativo em tela cheia, sem barra de endereços do navegador!

### No iPhone / iPad (Safari):
1. Abra o site no Safari.
2. Toque no botão de compartilhar (quadrado com seta para cima).
3. Toque em **"Adicionar à Tela de Início"**.

---

## 12. Solução de Problemas Comuns

### 1. Tela Branca ao abrir
- **Causa:** O arquivo `js/config.js` não foi configurado ou há erro de digitação na URL do Supabase.
- **Solução:** Abra o console do navegador (`F12` no teclado) e confira se a URL começa com `https://` e termina com `.supabase.co`.

### 2. Mensagem "Permission denied" ou erro de RLS
- **Causa:** O usuário logado está com `ativo = false` ou o `supabase/schema.sql` não foi executado no SQL Editor.
- **Solução:** Verifique na aba **Cadastros → Usuários** se o operador está marcado como `ATIVO`. Se você for o primeiro usuário, execute novamente o `supabase/schema.sql`.

### 3. O coletor bipa mas não envia
- **Causa:** O leitor de código de barras físico do coletor está configurado para não enviar a tecla `Enter` após a leitura.
- **Solução:** O app possui detecção automática: ao atingir 44 dígitos ele grava sozinho. Se o leitor cortar a leitura, configure o sufixo `Carriage Return / Enter` no manual do seu coletor (Zebra, Honeywell ou Datalogic).

### 4. O teclado virtual do Android fica subindo e atrapalhando
- **Causa:** O campo de texto padrão do Android chama o teclado da tela.
- **Solução:** O aplicativo já inicia com o modo `inputmode="none"`. O botão **"⌨ Teclado (Desligado)"** deve permanecer desligado para que o teclado da tela não apareça durante a operação com leitor a laser.

---

## 13. Aviso Importante sobre Segurança

- A chave `anon public key` colocada no `js/config.js` é **pública por padrão**. Isso é o comportamento oficial e seguro da arquitetura Supabase.
- A segurança dos seus dados **não depende de esconder a anon key**, mas sim das políticas **RLS (Row Level Security)** criadas no arquivo SQL:
  - Operadores do recebimento não conseguem alterar ou apagar notas.
  - Usuários inativos não conseguem ler nenhuma informação da empresa.
  - Somente o ADMIN tem permissão para cadastrar ou excluir registros.
- **NUNCA cole a chave `service_role` no código front-end.** Ela é exclusiva para rotinas internas de servidor.
