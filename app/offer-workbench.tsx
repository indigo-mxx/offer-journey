"use client";

import { useState, type ReactNode } from "react";
import type { Application, OfferCompensationDetails } from "@/db/schema";
import { calculateOfferIncome, normalizeOfferCompensationDetails } from "@/lib/offer-calculator";

type CalculationRecord = { id: string; name: string; savedAt: string; details: OfferCompensationDetails };
const money = (value: number) => value.toLocaleString("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 });

export function OfferWorkbench({ ownerKey, applications, details, onRestore, onOpen, children }: {
  ownerKey: string; applications: Application[]; details: OfferCompensationDetails;
  onRestore: (details: OfferCompensationDetails) => void; onOpen: (application: Application) => void; children: ReactNode;
}) {
  const storageKey = `offer-journey:calculator-history:${ownerKey}`;
  const [records, setRecords] = useState<CalculationRecord[]>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.savedAt === "string" && item.details && typeof item.details === "object").slice(0, 7).map((item) => ({ ...item, details: normalizeOfferCompensationDetails(item.details) })) : [];
    } catch { return []; }
  });
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"calculate" | "compare" | "friends">("calculate");
  const [selected, setSelected] = useState<string[]>([]);
  const ownOffers = applications.filter((item) => item.isOwner !== false && item.status === "Offer");
  const friendOffers = applications.filter((item) => item.isOwner === false && item.status === "Offer" && item.visibility === "full" && item.offerShared);
  const compared = ownOffers.filter((item) => selected.includes(item.id));
  function saveRecord() {
    if (!(details.monthlyBaseSalary > 0)) { setMessage("请先填写月基础工资，再保存本次计算。"); return; }
    const record = { id: crypto.randomUUID(), name: name.trim() || `${details.city || "未填城市"} · ${money(details.monthlyBaseSalary)} × ${details.salaryMonths}薪`, savedAt: new Date().toISOString(), details: normalizeOfferCompensationDetails(details) };
    const next = [record, ...records].slice(0, 7);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setRecords(next); setMessage("已保存本次计算，保留最近 7 次记录。"); }
    catch { setMessage("浏览器存储不可用，本次记录未保存。"); }
  }
  const rows: Array<{ label: string; value: (app: Application) => string }> = [
    { label: "Base 地", value: (a) => a.offerCompensationDetails?.city || a.base || "未填写" },
    { label: "薪酬结构", value: (a) => a.offerCompensation || "未填写" },
    ...([
      ["年税前现金", "annualGrossCash"], ["年实际到账", "annualTakeHome"],
      ["公积金 + 税后薪资", "annualTakeHomeWithHousingFund"], ["月均实际到账", "averageMonthlyTakeHome"],
      ["年度公积金入账", "annualHousingFundAccount"], ["年度个税", "annualTax"],
    ] as const).map(([label, key]) => ({ label, value: (a: Application) => a.offerCompensationDetails?.monthlyBaseSalary ? money(calculateOfferIncome(a.offerCompensationDetails)[key]) : "待补充计算参数" })),
    { label: "月薪 / 薪数", value: (a) => a.offerCompensationDetails?.monthlyBaseSalary ? `${money(a.offerCompensationDetails.monthlyBaseSalary)} × ${a.offerCompensationDetails.salaryMonths}` : "未填写" },
    { label: "签字费", value: (a) => a.offerCompensationDetails ? money(a.offerCompensationDetails.signingBonus) : "未填写" },
    { label: "股权估值（非现金）", value: (a) => a.offerCompensationDetails ? money(a.offerCompensationDetails.equityAnnualValue) : "未填写" },
    { label: "公积金比例（个人 / 公司）", value: (a) => a.offerCompensationDetails ? `${a.offerCompensationDetails.housingFundRate}% / ${a.offerCompensationDetails.employerHousingFundRate}%` : "未填写" },
    { label: "答复截止", value: (a) => a.offerDeadline ? new Date(a.offerDeadline).toLocaleString("zh-CN") : "未填写" },
    { label: "预计入职", value: (a) => a.offerOnboardDate || "未填写" },
    { label: "福利待遇", value: (a) => a.offerBenefits || "未填写" },
    { label: "补充说明", value: (a) => a.offerNote || "未填写" },
  ];
  return <div className="offer-workbench">
    <nav className="offer-workbench-tabs" aria-label="Offer 工具">
      {([ ["calculate", "计算与历史"], ["compare", `我的 Offer 对比 · ${ownOffers.length}`], ["friends", `好友 Offer · ${friendOffers.length}`] ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}
    </nav>
    {tab === "calculate" ? <>
      <section className="offer-history" aria-label="最近七次计算">
        <h3>最近 7 次计算</h3><p>点击保存记录一次方案，刷新后可恢复；历史仅保存在当前浏览器，按账户分别记录。</p>
        <div className="offer-history-save"><input aria-label="计算记录名称" maxLength={80} placeholder="方案名称，例如：杭州 A 公司" value={name} onChange={(event) => setName(event.target.value)} /><button type="button" className="primary-button" onClick={saveRecord}>保存本次计算</button></div>
        <p role="status">{message}</p>
        <div className="offer-history-list">{records.map((record) => <button type="button" key={record.id} onClick={() => { onRestore(record.details); setName(record.name); setMessage(`已恢复：${record.name}`); }}><strong>{record.name}</strong><span>年到账 {money(calculateOfferIncome(record.details).annualTakeHome)}</span><small>{new Date(record.savedAt).toLocaleString("zh-CN")} · 点击恢复</small></button>)}</div>
        {!records.length && <p>还没有保存的计算方案。</p>}
      </section>{children}
    </> : tab === "compare" ? <section className="offer-comparison">
      <h2>我的 Offer 对比</h2><p>选择已有 Offer，横向对比收入、城市、福利和截止时间。金额采用各方案自己的缴费与扣税参数。</p>
      <div className="offer-choice-list">{ownOffers.map((app) => <label key={app.id}><input type="checkbox" checked={selected.includes(app.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, app.id] : ids.filter((id) => id !== app.id))} />{app.company} · {app.position}</label>)}</div>
      {compared.length ? <div className="offer-comparison-scroll"><table><thead><tr><th>对比项目</th>{compared.map((app) => <th key={app.id}>{app.company}<small>{app.position}</small><button type="button" onClick={() => onOpen(app)}>详情 / 设置共享</button></th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th>{row.label}</th>{compared.map((app) => <td key={app.id}>{row.value(app)}</td>)}</tr>)}</tbody></table></div> : <p>{ownOffers.length ? "请勾选两份或更多 Offer 开始对比。" : "暂无 Offer，请先在我的投递中将已录用岗位设为 Offer。"}</p>}
    </section> : <section className="offer-comparison"><h2>好友共享的 Offer</h2><p>在 Offer 详情勾选“共享给好友”并保存，共同小组成员即可查看薪酬结构、收入明细和录用条款。</p><div className="offer-history-list">{friendOffers.map((app) => <button type="button" key={app.id} onClick={() => onOpen(app)}><strong>{app.company} · {app.position}</strong><span>{app.ownerName || app.ownerEmail || "好友"} · {app.base}</span><small>查看完整 Offer →</small></button>)}</div>{!friendOffers.length && <p>还没有好友共享的 Offer；仅共享岗位进度不会公开 Offer 详情。</p>}</section>}
  </div>;
}
