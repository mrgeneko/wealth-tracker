const req = require('yahoo-finance2');
const YahooFinance = (req && req.default) ? req.default : req;
const yf = new YahooFinance();

async function test() {
  const quoteSummaryResult = await yf.quoteSummary('ABBV', {
    modules: ['price', 'summaryDetail', 'assetProfile', 'summaryProfile']
  });

  const price = quoteSummaryResult.price || quoteSummaryResult;
  const summaryDetail = quoteSummaryResult.summaryDetail || {};
  const summaryProfile = quoteSummaryResult.summaryProfile || {};
  const assetProfile = quoteSummaryResult.assetProfile || {};

  const sector = (assetProfile && assetProfile.sector)
    || (summaryProfile && summaryProfile.sector)
    || (summaryDetail && summaryDetail.sector)
    || (price && price.sector) || null;

  console.log('assetProfile.sector:', assetProfile.sector);
  console.log('summaryProfile.sector:', summaryProfile.sector);
  console.log('summaryDetail.sector:', summaryDetail.sector);
  console.log('price.sector:', price.sector);
  console.log('Final sector:', sector);
}

test().catch(console.error);
