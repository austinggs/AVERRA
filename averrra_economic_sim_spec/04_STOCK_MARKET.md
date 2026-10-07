# 04 — STOCK MARKET

## Initial fictional companies
Create 24 companies across 8 sectors. Names are intentionally fictional.

Technology:
- Nexora Systems (NXR)
- QuantaGrid (QGD)
- VertexAI Labs (VAI)

Finance:
- CrestBank (CRB)
- Meridian Capital (MDC)
- UnityPay Financial (UPF)

Energy:
- Solterra Energy (STE)
- Voltaris Power (VPS)
- TerraFuel (TRF)

Consumer:
- UrbanMart (UBM)
- Freshlane Foods (FLF)
- PrimeHome Retail (PHR)

Healthcare:
- Medivance (MDV)
- VitaCore (VTC)
- Helix Pharma (HXP)

Telecommunications:
- WaveLink (WVL)
- SignalOne (S1C)
- Connecta Mobile (CTM)

Industrial:
- IronPeak (IPK)
- Atlas Machines (ATM)
- BuildCore (BCR)

Transportation:
- SwiftHaul (SWH)
- AeroTransit (ART)
- MetroDrive (MDR)

## Launch price range
Use prices between ₦50 and ₦5,000 virtual NGN per share.
Initial shares outstanding: 50M–5B depending on company size.

## Market orders
V1 supports:
- BUY MARKET
- SELL MARKET

Execution uses current server price plus configured slippage.

Slippage defaults:
- highly liquid: 0.02%
- normal: 0.08%
- illiquid: 0.25%

## Limit orders
V1 should support limit orders if implementation complexity permits; otherwise keep behind a feature flag.
Limit order matching occurs server-side.
No user-controlled partial execution outcome.

## Fees
Default simulated exchange fee: 0.15% of notional for stocks.
Fee is a game-economy sink.

## Positions
Track:
- quantity
- average cost
- total cost
- realized P&L
- unrealized P&L
- current market value
- first acquisition time

## Dividends
V1 supports occasional dividends.
Dividend payment:
`shares_held_at_record_date * dividend_per_share`.
Dividend is paid into virtual cash.

## Corporate actions
V1 optional:
- stock split
- reverse split
- dividend
- buyback announcement
- rights issue

All corporate actions must preserve player value mathematically except where the fictional event intentionally changes value.

## Trading restrictions
Do not allow:
- negative quantity
- trading with insufficient cash
- selling more shares than owned
- orders after market suspension
- cross-account manipulation through client calls
