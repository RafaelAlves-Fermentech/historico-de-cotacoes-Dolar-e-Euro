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
| `$select` | `cotacaoVenda,dataHoraCotacao` |
| `$format` | `json` |

O mesmo recurso atende as duas moedas. Ele foi escolhido em vez de
`CotacaoDolarPeriodo` porque aceita o parâmetro `moeda` e expõe `tipoBoletim`,
permitindo isolar o boletim de **Fechamento** — a PTAX oficial do dia.
Verificou-se que os valores retornados são idênticos aos de
`CotacaoDolarPeriodo` para o Dólar.

### Cotação de venda

O painel usa **exclusivamente** o campo `cotacaoVenda`.

`cotacaoCompra` não é sequer solicitado ao servidor (graças ao `$select`),
portanto não existe caminho no código por onde um valor de compra possa
entrar. A palavra "compra" aparece no código-fonte apenas em comentários.

Exemplo de 28/08/2026: a API retorna `cotacaoCompra = 5,19990` e
`cotacaoVenda = 5,20050`. O painel exibe **R$ 5,2005**.

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
Período 01/08/2026 a 31/08/2026:

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
