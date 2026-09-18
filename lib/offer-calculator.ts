import type { OfferCompensationDetails } from "@/db/schema";

export type OfferIncomeMonth = {
  month: number;
  grossCash: number;
  salary: number;
  bonus: number;
  employeeSocialInsurance: number;
  employeeHousingFund: number;
  individualIncomeTax: number;
  otherDeduction: number;
  takeHome: number;
  housingFundAccount: number;
};

export type OfferIncomeCalculation = {
  annualGrossCash: number;
  annualTotalPackage: number;
  annualTax: number;
  annualEmployeeSocialInsurance: number;
  annualEmployeeHousingFund: number;
  annualTakeHome: number;
  annualHousingFundAccount: number;
  annualTakeHomeWithHousingFund: number;
  averageMonthlyGross: number;
  averageMonthlyTakeHome: number;
  averageMonthlyTakeHomeWithHousingFund: number;
  effectiveTaxRate: number;
  separateBonusTax: number;
  months: OfferIncomeMonth[];
};

const CITY_RATE_PRESETS: Record<string, Pick<OfferCompensationDetails, "pensionRate" | "medicalRate" | "unemploymentRate" | "housingFundRate" | "employerHousingFundRate">> = {
  北京: { pensionRate: 8, medicalRate: 2, unemploymentRate: 0.5, housingFundRate: 12, employerHousingFundRate: 12 },
  上海: { pensionRate: 8, medicalRate: 2, unemploymentRate: 0.5, housingFundRate: 7, employerHousingFundRate: 7 },
  深圳: { pensionRate: 8, medicalRate: 2, unemploymentRate: 0.3, housingFundRate: 5, employerHousingFundRate: 5 },
  广州: { pensionRate: 8, medicalRate: 2, unemploymentRate: 0.2, housingFundRate: 5, employerHousingFundRate: 5 },
  杭州: { pensionRate: 8, medicalRate: 2, unemploymentRate: 0.5, housingFundRate: 12, employerHousingFundRate: 12 },
  成都: { pensionRate: 8, medicalRate: 2, unemploymentRate: 0.4, housingFundRate: 12, employerHousingFundRate: 12 },
};

const DEFAULT_RATES = { pensionRate: 8, medicalRate: 2, unemploymentRate: 0.5, housingFundRate: 7, employerHousingFundRate: 7 };

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percent(value: number) {
  return Math.max(0, Math.min(100, finiteNumber(value)));
}

function annualTaxFor(taxableIncome: number) {
  const taxable = Math.max(0, taxableIncome);
  if (taxable <= 36_000) return taxable * 0.03;
  if (taxable <= 144_000) return taxable * 0.1 - 2_520;
  if (taxable <= 300_000) return taxable * 0.2 - 16_920;
  if (taxable <= 420_000) return taxable * 0.25 - 31_920;
  if (taxable <= 660_000) return taxable * 0.3 - 52_920;
  if (taxable <= 960_000) return taxable * 0.35 - 85_920;
  return taxable * 0.45 - 181_920;
}

function annualBonusTax(bonus: number) {
  const amount = Math.max(0, bonus);
  const monthly = amount / 12;
  if (monthly <= 3_000) return amount * 0.03;
  if (monthly <= 12_000) return amount * 0.1 - 210;
  if (monthly <= 25_000) return amount * 0.2 - 1_410;
  if (monthly <= 35_000) return amount * 0.25 - 2_660;
  if (monthly <= 55_000) return amount * 0.3 - 4_410;
  if (monthly <= 80_000) return amount * 0.35 - 7_160;
  return amount * 0.45 - 15_160;
}

function salaryFromText(value: string) {
  const match = value.match(/([\d.]+)\s*[kK千]/);
  if (match) return finiteNumber(match[1]) * 1_000;
  const plain = value.match(/(?:^|[^\d])([1-9]\d{3,5})(?:[^\d]|$)/);
  return plain ? finiteNumber(plain[1]) : 0;
}

function salaryMonthsFromText(value: string) {
  const match = value.match(/[×xX*]\s*([12]\d(?:\.\d+)?)/);
  return match ? Math.max(12, Math.min(24, finiteNumber(match[1], 12))) : 12;
}

export function offerCityRates(city: string) {
  const cityName = Object.keys(CITY_RATE_PRESETS).find((name) => city.includes(name));
  return cityName ? CITY_RATE_PRESETS[cityName] : DEFAULT_RATES;
}

export function emptyOfferCompensationDetails(city = "", salaryText = ""): OfferCompensationDetails {
  const monthlyBaseSalary = salaryFromText(salaryText);
  return {
    currency: "CNY",
    city,
    monthlyBaseSalary,
    salaryMonths: salaryMonthsFromText(salaryText),
    probationMonths: 0,
    probationSalaryRate: 100,
    performanceBonus: 0,
    signingBonus: 0,
    monthlyAllowance: 0,
    otherAnnualCash: 0,
    equityAnnualValue: 0,
    bonusTaxMode: "separate",
    bonusMonth: 12,
    signingBonusMonth: 1,
    socialInsuranceBase: monthlyBaseSalary,
    housingFundBase: monthlyBaseSalary,
    ...offerCityRates(city),
    specialDeductionMonthly: 0,
    otherDeductionMonthly: 0,
  };
}

export function normalizeOfferCompensationDetails(value: Partial<OfferCompensationDetails> | null | undefined, city = "", salaryText = ""): OfferCompensationDetails {
  const fallback = emptyOfferCompensationDetails(city, salaryText);
  if (!value || typeof value !== "object") return fallback;
  return {
    ...fallback,
    currency: "CNY",
    city: typeof value.city === "string" ? value.city.slice(0, 100) : fallback.city,
    monthlyBaseSalary: Math.max(0, finiteNumber(value.monthlyBaseSalary, fallback.monthlyBaseSalary)),
    salaryMonths: Math.max(12, Math.min(24, finiteNumber(value.salaryMonths, 12))),
    probationMonths: Math.max(0, Math.min(12, Math.round(finiteNumber(value.probationMonths)))),
    probationSalaryRate: percent(value.probationSalaryRate ?? 100),
    performanceBonus: Math.max(0, finiteNumber(value.performanceBonus)),
    signingBonus: Math.max(0, finiteNumber(value.signingBonus)),
    monthlyAllowance: Math.max(0, finiteNumber(value.monthlyAllowance)),
    otherAnnualCash: Math.max(0, finiteNumber(value.otherAnnualCash)),
    equityAnnualValue: Math.max(0, finiteNumber(value.equityAnnualValue)),
    bonusTaxMode: value.bonusTaxMode === "combined" ? "combined" : "separate",
    bonusMonth: Math.max(1, Math.min(12, Math.round(finiteNumber(value.bonusMonth, 12)))),
    signingBonusMonth: Math.max(1, Math.min(12, Math.round(finiteNumber(value.signingBonusMonth, 1)))),
    socialInsuranceBase: Math.max(0, finiteNumber(value.socialInsuranceBase, fallback.socialInsuranceBase)),
    housingFundBase: Math.max(0, finiteNumber(value.housingFundBase, fallback.housingFundBase)),
    pensionRate: percent(value.pensionRate ?? fallback.pensionRate),
    medicalRate: percent(value.medicalRate ?? fallback.medicalRate),
    unemploymentRate: percent(value.unemploymentRate ?? fallback.unemploymentRate),
    housingFundRate: percent(value.housingFundRate ?? fallback.housingFundRate),
    employerHousingFundRate: percent(value.employerHousingFundRate ?? fallback.employerHousingFundRate),
    specialDeductionMonthly: Math.max(0, finiteNumber(value.specialDeductionMonthly)),
    otherDeductionMonthly: Math.max(0, finiteNumber(value.otherDeductionMonthly)),
  };
}

export function calculateOfferIncome(input: OfferCompensationDetails): OfferIncomeCalculation {
  const details = normalizeOfferCompensationDetails(input);
  const base = details.monthlyBaseSalary;
  const bonus = base * Math.max(0, details.salaryMonths - 12) + details.performanceBonus;
  const social = details.socialInsuranceBase * (details.pensionRate + details.medicalRate + details.unemploymentRate) / 100;
  const employeeFund = details.housingFundBase * details.housingFundRate / 100;
  const employerFund = details.housingFundBase * details.employerHousingFundRate / 100;
  const separateBonus = details.bonusTaxMode === "separate" ? bonus : 0;
  const separateBonusTax = money(annualBonusTax(separateBonus));
  let cumulativeTaxableGross = 0;
  let cumulativeTaxPaid = 0;

  const months = Array.from({ length: 12 }, (_, index): OfferIncomeMonth => {
    const month = index + 1;
    const salary = base * (month <= details.probationMonths ? details.probationSalaryRate / 100 : 1) + details.monthlyAllowance;
    const bonusPaid = month === details.bonusMonth ? bonus : 0;
    const signingPaid = month === details.signingBonusMonth ? details.signingBonus + details.otherAnnualCash : 0;
    const grossCash = salary + bonusPaid + signingPaid;
    const salaryTaxGross = salary + signingPaid + (details.bonusTaxMode === "combined" ? bonusPaid : 0);
    cumulativeTaxableGross += salaryTaxGross;
    const cumulativeTaxable = cumulativeTaxableGross
      - month * 5_000
      - month * (social + employeeFund + details.specialDeductionMonthly);
    const cumulativeSalaryTax = Math.max(0, annualTaxFor(cumulativeTaxable));
    const salaryTax = Math.max(0, cumulativeSalaryTax - cumulativeTaxPaid);
    cumulativeTaxPaid = cumulativeSalaryTax;
    const bonusTax = month === details.bonusMonth ? separateBonusTax : 0;
    const individualIncomeTax = salaryTax + bonusTax;
    const takeHome = grossCash - social - employeeFund - individualIncomeTax - details.otherDeductionMonthly;
    return {
      month,
      grossCash: money(grossCash),
      salary: money(salary),
      bonus: money(bonusPaid + signingPaid),
      employeeSocialInsurance: money(social),
      employeeHousingFund: money(employeeFund),
      individualIncomeTax: money(individualIncomeTax),
      otherDeduction: money(details.otherDeductionMonthly),
      takeHome: money(takeHome),
      housingFundAccount: money(employeeFund + employerFund),
    };
  });

  const sum = (key: keyof OfferIncomeMonth) => months.reduce((total, item) => total + Number(item[key]), 0);
  const annualGrossCash = money(sum("grossCash"));
  const annualTax = money(sum("individualIncomeTax"));
  const annualTakeHome = money(sum("takeHome"));
  const annualHousingFundAccount = money(sum("housingFundAccount"));
  const annualTakeHomeWithHousingFund = money(annualTakeHome + annualHousingFundAccount);
  return {
    annualGrossCash,
    annualTotalPackage: money(annualGrossCash + details.equityAnnualValue + employerFund * 12),
    annualTax,
    annualEmployeeSocialInsurance: money(sum("employeeSocialInsurance")),
    annualEmployeeHousingFund: money(sum("employeeHousingFund")),
    annualTakeHome,
    annualHousingFundAccount,
    annualTakeHomeWithHousingFund,
    averageMonthlyGross: money(annualGrossCash / 12),
    averageMonthlyTakeHome: money(annualTakeHome / 12),
    averageMonthlyTakeHomeWithHousingFund: money(annualTakeHomeWithHousingFund / 12),
    effectiveTaxRate: annualGrossCash ? money(annualTax / annualGrossCash * 100) : 0,
    separateBonusTax,
    months,
  };
}
