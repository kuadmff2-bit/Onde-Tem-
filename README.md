# Onde Tem?

Portal local gratuito para encontrar **comércios, profissionais e classificados**. A interface funciona em modo demonstração sem banco. Para ativar contas, anúncios e painel administrativo, conecte um banco Cloudflare D1.

## O que já existe

- Busca por termo e cidade
- Categorias de comércio e produtos
- Classificados estilo marketplace
- Contato direto pelo WhatsApp
- Cadastro por nome + WhatsApp + senha + cidade
- Login e sessão segura
- Troca de senha
- Recuperação de senha via solicitação ao suporte/admin
- Painel do usuário
- Favoritos
- Cadastro de comércio/profissional
- Envio de anúncio para aprovação
- Painel administrativo para aprovar/recusar
- Senhas com PBKDF2 + salt
- Cookies HttpOnly, Secure e SameSite=Lax
- Validação e limite de imagens
- Página 404 e política de privacidade
- Layout responsivo
- Logo própria com detetive

## Rodar a parte visual

Abra `public/index.html` com um servidor local. A forma mais simples é usar a extensão Live Server do VS Code.

## Ativar o backend gratuitamente no Cloudflare

### 1. Criar o banco D1

```bash
npx wrangler login
npx wrangler d1 create onde-tem-db
```

O Cloudflare mostrará um bloco `[[d1_databases]]`. Copie esse bloco para `wrangler.toml` e confirme que o binding é:

```toml
binding = "DB"
```

Depois crie as tabelas:

```bash
npx wrangler d1 execute onde-tem-db --remote --file=./schema.sql
```

### 2. Definir o administrador

```bash
npx wrangler secret put ADMIN_PHONE
```

Digite o número com país + DDD + telefone, por exemplo `5592999999999`. A conta criada com esse mesmo WhatsApp terá acesso ao painel admin.

### 3. Fotos com R2 (opcional)

O site funciona sem R2, mas anúncios com foto própria precisam dele.

```bash
npx wrangler r2 bucket create onde-tem-media
```

Adicione ao `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "onde-tem-media"
```

### 4. Publicar

```bash
npx wrangler deploy
```

## Segurança

Não coloque senhas, tokens ou chaves no GitHub. O número usado em `ADMIN_PHONE` é configurado como variável secreta do Worker. As senhas de usuários nunca são armazenadas em texto puro.

## Antes de lançar oficialmente

Conecte o D1, teste cadastro/login/troca de senha, configure o admin, teste aprovação de anúncios, confirme os links de WhatsApp e depois configure domínio, Analytics e sitemap usando o endereço final do site.
