/* =============================================================
   config.js — Constantes do painel.
   Camada: configuração. Não contém lógica de rede nem de UI.
   ============================================================= */
(function (global) {
  'use strict';

  /**
   * Recurso oficial do Banco Central (plataforma Olinda, serviço PTAX).
   * Documentação: https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/documentacao
   *
   * Usamos CotacaoMoedaPeriodo para AMBAS as moedas (USD e EUR) porque ele
   * aceita o parâmetro `moeda` e expõe `tipoBoletim`, permitindo isolar o
   * boletim de FECHAMENTO — que é a PTAX oficial do dia.
   *
   * Validado em 31/08/2026: os valores retornados por este recurso são
   * idênticos aos de CotacaoDolarPeriodo e às séries SGS 1 (dólar venda)
   * e 21619 (euro venda).
   */
  var PTAX_BASE =
    'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/' +
    'CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)';

  var CURRENCIES = {
    USD: {
      code: 'USD',
      bcbSymbol: 'USD',      // parâmetro `moeda` na API
      bcbCode: 220,          // código da moeda no BCB (referência institucional)
      name: 'Dólar',
      fullName: 'Dólar dos Estados Unidos',
      symbol: 'US$',
      color: '#007681',
      firstAvailable: '1990-01-02'
    },
    EUR: {
      code: 'EUR',
      bcbSymbol: 'EUR',
      bcbCode: 978,
      name: 'Euro',
      fullName: 'Euro',
      symbol: '\u20AC',
      color: '#E57200',
      firstAvailable: '1998-12-31'
    }
  };

  global.APP_CONFIG = {
    PTAX_BASE: PTAX_BASE,
    /** Boletim que representa a PTAX oficial de fechamento do dia. */
    BULLETIN: 'Fechamento',
    /** Campo da API que representa a COTAÇÃO DE VENDA. Nunca usar cotacaoCompra. */
    SELL_FIELD: 'cotacaoVenda',
    CURRENCIES: CURRENCIES,
    ORDER: ['USD', 'EUR'],
    /** Data mínima aceita pelos filtros (primeira cotação de dólar disponível). */
    MIN_DATE: '1990-01-02',
    /** Consultas acima disso são divididas em janelas (ver bcb-service.js). */
    CHUNK_YEARS: 5
  };
})(window);
