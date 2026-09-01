/** ISO 4217 code -> display name.
 *
 *  Sourced from Frankfurter's /v1/currencies (the same feed that supplies the
 *  rates), snapshotted here rather than fetched: currency names do not change,
 *  and a card tooltip should not depend on a network call.
 */
export const CURRENCY_NAMES: Record<string, string> = {
  AUD: "Australian Dollar",
  BRL: "Brazilian Real",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  CNY: "Chinese Renminbi Yuan",
  CZK: "Czech Koruna",
  DKK: "Danish Krone",
  EUR: "Euro",
  GBP: "British Pound",
  HKD: "Hong Kong Dollar",
  HUF: "Hungarian Forint",
  IDR: "Indonesian Rupiah",
  ILS: "Israeli New Shekel",
  INR: "Indian Rupee",
  ISK: "Icelandic Króna",
  JPY: "Japanese Yen",
  KRW: "South Korean Won",
  MXN: "Mexican Peso",
  MYR: "Malaysian Ringgit",
  NOK: "Norwegian Krone",
  NZD: "New Zealand Dollar",
  PHP: "Philippine Peso",
  PLN: "Polish Złoty",
  RON: "Romanian Leu",
  SEK: "Swedish Krona",
  SGD: "Singapore Dollar",
  THB: "Thai Baht",
  TRY: "Turkish Lira",
  USD: "United States Dollar",
  ZAR: "South African Rand",
};

/** "USDEUR" -> "Euro".
 *
 *  Forex rows are stored USD-base, so every pair shares the USD leg — naming it
 *  on each row adds no information. Falls back to the raw ticker for anything
 *  that is not a recognised USD-base pair. */
export function forexPairName(ticker: string): string {
  const t = ticker.toUpperCase();
  if (!t.startsWith("USD") || t.length !== 6) return ticker;
  return CURRENCY_NAMES[t.slice(3)] ?? ticker;
}
