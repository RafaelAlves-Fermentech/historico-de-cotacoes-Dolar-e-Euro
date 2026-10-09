# Painel Histórico de Cotações — Dólar e Euro

Painel web para acompanhamento histórico das **cotações de venda** do Dólar dos
EUA e do Euro, com dados oficiais do **Banco Central do Brasil**.

## Como abrir

Abra `index.html` diretamente no navegador. Não há build, dependências nem
instalação — a API do Banco Central aceita requisições de origem local.

Para servir por HTTP durante testes (opcional):

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Depois acesse `http://localhost:8123/`.

## Fonte dos dados

Plataforma **Olinda**, serviço **PTAX v1**, recurso `CotacaoMoedaPeriodo`:

```
https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/
CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)
```

| Parâmetro | Valor |
|---|---|
| `@moeda` | `'USD'` ou `'EUR'` |
| `@dataInicial` / `@dataFinalCotacao` | `'MM-DD-YYYY'` |
| `$filter` | `tipoBoletim eq 'Fechamento'` |
| `$format` | `json` |

O mesmo recurso atende as duas moedas. Ele foi escolhido em vez de
`CotacaoDolarPeriodo` porque aceita o parâmetro `moeda` e expõe `tipoBoletim`,
permitindo isolar o boletim de **Fechamento** — a PTAX oficial do dia.
Verificou-se que os valores retornados são idênticos aos de
`CotacaoDolarPeriodo` para o Dólar.

### Cotação de venda

O painel usa **exclusivamente** o campo `cotacaoVenda`.

A resposta do BCB traz também `cotacaoCompra` e as paridades, mas a função
`normalize` em `src/bcb-service.js` lê apenas `cotacaoVenda` e monta o modelo
com esse único valor numérico. Nenhum outro campo atravessa a camada de dados.
A palavra "compra" aparece no código-fonte apenas em comentários.

Exemplo de 09/10/2026: a API retorna `cotacaoCompra = 4,98860` e
`cotacaoVenda = 4,98920`. O painel exibe **R$ 4,9892**.

### Resiliência da consulta

A consulta é montada em camadas, da mais enxuta para a mais crua:

| | Parâmetros | Observação |
|---|---|---|
| Tentativa 1 | rota + `$filter` + `$format` | payload menor, filtro no servidor |
| Tentativa 2 | rota + `$format` | todos os boletins, filtrados localmente |

Se o BCB recusar um parâmetro opcional (HTTP 4xx), o painel repete a consulta
sem ele em vez de ficar sem dados. Apenas o caminho mínimo — parâmetros de
rota mais `$format` — é tratado como obrigatório.

O filtro por boletim de **Fechamento** é aplicado também no cliente, sempre
que o campo `tipoBoletim` estiver presente. A regra vale mesmo que o `$filter`
tenha sido recusado pelo servidor — os dois caminhos produzem séries
idênticas, o que está verificado nos testes.

#### Incidente de 09/10/2026

O painel parou de exibir valores porque o serviço do BCB passou a responder
**403 a qualquer consulta que usasse `$select`** — parâmetro que o painel
usava para trazer só dois campos. O recurso em si continuava íntegro: apenas
aquele parâmetro passou a ser recusado.

Correções aplicadas:

- `$select` removido; os campos são selecionados na normalização.
- Consulta em camadas, para que a recusa de um parâmetro opcional não derrube
  o painel de novo.
- Filtro de boletim de fechamento garantido no cliente.
- O aviso de erro passou a distinguir recusa do serviço (4xx) de oscilação de
  rede, e informa o código HTTP. Antes, um 403 era apresentado como falha
  passageira com a orientação de "tentar novamente em alguns instantes".

### Dias sem cotação

Só entram no painel as datas efetivamente retornadas pelo Banco Central.
Sábados, domingos, feriados e dias sem registro simplesmente não existem na
série: não há interpolação, média, repetição do último valor nem qualquer
preenchimento artificial. O eixo horizontal do gráfico avança por dia de
boletim, não por dia de calendário.

## Arquitetura

Camada de dados e camada de interface são separadas. Nenhum componente visual
chama a rede.

```
API BCB (Olinda/PTAX)
   └─ src/bcb-service.js   consulta, janelamento, normalização   ← único fetch
        └─ src/cache.js    validade por janela (localStorage)
             └─ src/analytics.js   cálculos puros do período
                  └─ src/app.js    estado do dashboard
                       └─ src/chart.js   renderização SVG
```

| Arquivo | Responsabilidade |
|---|---|
| `src/config.js` | Endpoint, moedas, cores, limites |
| `src/dates.js` | Datas e conversão para o formato do BCB |
| `src/format.js` | Formatação brasileira (4 casas, percentuais) |
| `src/cache.js` | Cache de janelas com validade diferenciada |
| `src/bcb-service.js` | Acesso à API, janelamento e normalização |
| `src/analytics.js` | Primeira/última, máxima/mínima, variação |
| `src/chart.js` | Gráfico de linhas em SVG (sem bibliotecas) |
| `src/app.js` | Estado, filtros e renderização |

### Modelo de dados

```js
{ date: "2026-08-28", currency: "USD", currencyName: "Dólar", sellRate: 5.2005 }
```

O campo principal é `sellRate`. Não existe `buyRate` no modelo.

## Período e histórico

- Atalhos: 7 dias, 30 dias, 90 dias, 6 meses, 12 meses, ano atual, personalizado.
- Consultas são divididas em janelas de até 5 anos e reunidas. Nada é truncado
  silenciosamente.
- Séries disponíveis na fonte: Dólar desde **02/01/1990**, Euro desde
  **31/12/1998**. Se o período pedido começar antes disso, o painel ajusta o
  início e avisa explicitamente.
- A tabela é paginada (25/50/100 linhas) e o gráfico reduz pontos preservando
  máximas e mínimas quando a série passa de 900 boletins.

### Cálculos

- **Cotação atual do card**: última cotação disponível *dentro do período
  filtrado* — não necessariamente a data de hoje.
- **Variação**: `((última / primeira) - 1) × 100`, usando a primeira e a última
  cotação **efetivamente disponíveis**, não as datas dos filtros.
- Os cálculos usam o valor original da fonte. O arredondamento para 4 casas
  existe apenas na exibição.

## Cache

Chave por moeda + janela de datas, em `localStorage`.

| Situação | Validade |
|---|---|
| Janela inteiramente no passado (fim < hoje) | 30 dias — a PTAX de um dia encerrado não muda |
| Janela que alcança hoje | 20 minutos — o boletim do dia sai por volta das 13h |

O botão **Atualizar dados** ignora o cache e consulta o Banco Central de novo.
Se a API falhar e existir cache vencido, os dados guardados são exibidos com o
aviso "Exibindo dados armazenados anteriormente".

## Validações realizadas

Validação cruzada contra o **SGS**, sistema de séries temporais do Banco
Central independente do PTAX/Olinda (série 1 = dólar venda, 21619 = euro venda).

Reexecutada em 09/10/2026 após a correção, período 09/09 a 09/10/2026 — todos
os valores idênticos ao SGS:

| | Painel | SGS |
|---|---|---|
| Boletins (USD / EUR) | 23 / 23 | 23 / 23 |
| USD primeira | 09/09 — 5,0979 | 09/09 — 5,0979 |
| USD última | 09/10 — 4,9892 | 09/10 — 4,9892 |
| USD máxima | 02/10 — 5,2238 | 02/10 — 5,2238 |
| USD mínima | 06/10 — 4,9698 | 06/10 — 4,9698 |
| USD variação | −2,132251% | −2,132251% |
| EUR primeira | 09/09 — 5,9278 | 09/09 — 5,9278 |
| EUR última | 09/10 — 5,5844 | 09/10 — 5,5844 |
| EUR variação | −5,793043% | −5,793043% |

Validação original, período 01/08/2026 a 31/08/2026:

| | Painel | SGS |
|---|---|---|
| Boletins (USD / EUR) | 20 / 20 | 20 / 20 |
| USD primeira | 03/08 — 5,0723 | 03/08 — 5,0723 |
| USD última | 28/08 — 5,2005 | 28/08 — 5,2005 |
| USD máxima | 14/08 — 5,2236 | 14/08 — 5,2236 |
| USD mínima | 03/08 — 5,0723 | 03/08 — 5,0723 |
| USD variação | +2,527453% | +2,527453% |
| EUR primeira | 03/08 — 5,8382 | 03/08 — 5,8382 |
| EUR última | 28/08 — 6,0315 | 28/08 — 6,0315 |
| EUR máxima | 20/08 — 6,0570 | 20/08 — 6,0570 |
| EUR mínima | 03/08 — 5,8382 | 03/08 — 5,8382 |
| EUR variação | +3,310952% | +3,310952% |

Conferências pontuais adicionais: 19/08/2026 (USD 5,1714 / EUR 6,0324) e
25/11/2025 (USD 5,3841 / EUR 6,2256) — ambas idênticas ao SGS.

Outros testes executados:

- Moeda isolada (só Dólar, só Euro) e as duas juntas.
- Fim de semana: período 29–30/08/2026 retorna vazio; nenhuma data de sábado
  ou domingo aparece em nenhuma série consultada.
- Feriado: 21/04/2026 (Tiradentes) corretamente ausente entre 20/04 e 22/04.
- Período sem dados: empty state exibido em gráfico e tabela, cards com "—".
- API indisponível sem cache: mensagem de erro, nenhum dado antigo na tela.
- API indisponível com cache: dados exibidos com aviso explícito.
- Falha parcial (só o Euro fora do ar): Dólar continua correto, Euro em branco.
- Cache: consulta de 2010 a 2026 (4.184 boletins) faz 8 requisições; repetir o
  mesmo período faz **0**; "Atualizar dados" força 8 novamente.
- Responsividade: 390 px, 768 px e 1320 px, sem rolagem horizontal indesejada.

## Acessibilidade

- Alta e queda são indicadas por glifo (▲ ▼ →), sinal (+/−) e palavra
  ("alta", "queda", "estável") — nunca só por cor.
- Gráfico navegável por teclado (setas, Home, End, Esc) com tooltip.
- `aria-label` do gráfico resume a série em texto; a tabela é a alternativa
  textual completa.
- Rótulos em todos os campos, foco visível, link "pular para o conteúdo" e
  suporte a `prefers-reduced-motion`.

## Limitações conhecidas

- **A PTAX de fechamento do dia corrente só existe após a publicação do
  boletim, por volta das 13h.** Antes disso o último dado do período é o do dia
  útil anterior. O painel mostra a data real de cada cotação exibida.
- **Não há fonte alternativa.** Se o Banco Central estiver fora do ar, o painel
  exibe cache (avisando) ou erro. Nenhum outro provedor é consultado.
- **Não há dados anteriores a 02/01/1990 (Dólar) e 31/12/1998 (Euro)** na fonte.
- O cache usa `localStorage`. Em navegação privada ou com armazenamento
  bloqueado, o painel continua funcionando, mas só com cache em memória.
- A tabela é ordenada por data decrescente por padrão (boletim mais recente
  primeiro). O cabeçalho "Data" alterna para ordem crescente.
