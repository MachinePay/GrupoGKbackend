# Backend - Sistema Financeiro Grupo GK

API REST em Node.js + Express + Prisma + PostgreSQL.

## Como rodar

1. Copie o arquivo .env.example para .env e ajuste DATABASE_URL e JWT_SECRET.
2. Instale dependencias: npm install
3. Gere o client Prisma: npm run prisma:generate
4. Rode migration: npm run prisma:migrate
5. Rode seed: npm run prisma:seed
6. Suba em desenvolvimento: npm run dev

Base URL: http://localhost:3001/api

## Endpoints

### Health

- GET /health

### Auth

- POST /auth/login
- GET /auth/me
- POST /auth/users (somente ADMIN)

Exemplo de payload (login):

```json
{
  "email": "admin@grupogk.com",
  "senha": "Admin@123"
}
```

As rotas abaixo exigem token Bearer no cabecalho Authorization.

Exemplo de payload (criar usuario por ADMIN):

```json
{
  "nome": "Analista Financeiro",
  "email": "financeiro@grupogk.com",
  "senha": "Senha@123",
  "perfil": "FINANCEIRO"
}
```

### Movimentacoes

- POST /movimentacoes

Exemplo de payload (ENTRADA):

```json
{
  "data": "2026-03-31",
  "valor": 1500,
  "tipo": "ENTRADA",
  "categoria": "INVESTIMENTO",
  "referencia": "Aporte",
  "status": "REALIZADO",
  "empresaId": 1,
  "contaDestinoId": 2
}
```

Exemplo de payload (TRANSFERENCIA):

```json
{
  "data": "2026-03-31",
  "valor": 250,
  "tipo": "TRANSFERENCIA",
  "categoria": "CUSTO_FIXO",
  "referencia": "Reorganizacao de caixa",
  "status": "REALIZADO",
  "empresaId": 1,
  "contaOrigemId": 1,
  "contaDestinoId": 2
}
```

### Dashboards

- GET /dashboards/consolidado
- GET /dashboards/empresa/:id
- GET /dashboards/contas

### Agenda

- GET /agenda?dataInicio=2026-03-01&dataFim=2026-03-31
- POST /agenda

Exemplo de payload:

```json
{
  "data": "2026-04-05",
  "titulo": "Fornecedor quiosque",
  "valor": 890,
  "prioridade": "ALTA",
  "status": "PREVISTO",
  "tipo": "PAGAR",
  "empresaId": 3
}
```

### Cadastros

- GET /cadastros/empresas
- POST /cadastros/empresas
- GET /cadastros/contas-bancarias?empresaId=1
- POST /cadastros/contas-bancarias
- GET /cadastros/projetos?empresaId=3
- POST /cadastros/projetos

Exemplo de conta bancaria:

```json
{
  "nome": "Santander GK",
  "banco": "Santander",
  "saldoAtual": 5000,
  "empresaId": 1
}
```

Exemplo de projeto:

```json
{
  "nome": "Quiosque Shopping Sul",
  "empresaId": 3
}
```

## Regras implementadas

- Movimentacao da empresa MaisQuiosque exige projetoId.
- Transferencias alteram saldos de contas, mas nao entram no consolidado de entradas/saidas.
- GiraKids aceita subcategoria TAKE_PARCERIA e PELUCIA_PARCERIA.
- Apenas movimentacoes REALIZADO atualizam saldo de conta automaticamente.

## Estrutura de pastas

- src/config
- src/controllers
- src/services
- src/routes
- src/middlewares
