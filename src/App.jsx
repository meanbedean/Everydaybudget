import { useState, useEffect, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell,
  ResponsiveContainer
} from "recharts";
import { createClient } from "@supabase/supabase-js";
import logo from "./EveryDayBudget.png";
import jsPDF from "jspdf";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY
);

// ── Design tokens ──────────────────────────────────────────
const C = {
  bg:        "#080c14",
  surface:   "#0d1420",
  card:      "#111827",
  border:    "rgba(56, 189, 248, 0.12)",
  borderHover: "rgba(56, 189, 248, 0.35)",
  accent:    "#38bdf8",
  accentDim: "rgba(56, 189, 248, 0.08)",
  purple:    "#a78bfa",
  textPrimary:   "#f1f5f9",
  textSecondary: "#64748b",
  textMuted:     "#334155",
};

const COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fb923c", "#f472b6"];

const CATEGORIES = [
  "Groceries","Stationery","Utility Bills","Fashion Shopping",
  "Electronics Shopping","Vegetables","Fish","Medicines",
  "School","Hospitals","Transport","Misc",
];

// ── Reusable style objects ──────────────────────────────────
const card = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: 16,
  padding: "24px",
};

const glowLine = {
  height: 1,
  background: `linear-gradient(90deg, transparent, ${C.accent}, transparent)`,
  opacity: 0.3,
  margin: "32px 0",
};

// ── Custom tooltip for charts ───────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#0d1420",
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: "10px 16px",
      fontSize: 13,
      color: C.textPrimary,
    }}>
      {label && <div style={{ color: C.textSecondary, marginBottom: 4, fontSize: 11 }}>{label}</div>}
      <div style={{ color: C.accent, fontWeight: 600 }}>
        ₹{Number(payload[0].value).toFixed(2)}
      </div>
    </div>
  );
};

export default function App() {
  const [amount, setAmount]     = useState("");
  const [category, setCategory] = useState("");
  const [expenses, setExpenses] = useState([]);
  const [user, setUser]         = useState(null);
  const [filterDays, setFilterDays] = useState(30);
  const [editingEntry, setEditingEntry] = useState(null);
  const [editAmount, setEditAmount]     = useState("");
  const [editCategory, setEditCategory] = useState("");

  const pieRef  = useRef();
  const lineRef = useRef();

  // ── Auth ────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_e, session) => {
        const u = session?.user || null;
        setUser(u);
        if (!u) setExpenses([]);
      }
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({ provider: "google" });

  const signOut = () => supabase.auth.signOut();

  // ── Fetch ───────────────────────────────────────────────
  const fetchExpenses = async () => {
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });
    setExpenses(data || []);
  };

  useEffect(() => {
    if (!user) return;
    fetchExpenses();
    const channel = supabase
      .channel("expenses-channel")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, fetchExpenses)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [user]);

  // ── Add ─────────────────────────────────────────────────
  const addExpense = async () => {
    if (!amount || !category) return;
    await supabase.from("expenses").insert([{
      amount: parseFloat(amount),
      category,
      user_id: user?.id || null,
    }]);
    setAmount("");
    setCategory("");
    fetchExpenses();
  };

  // ── Delete ──────────────────────────────────────────────
  const deleteExpense = async (id) => {
    await supabase.from("expenses").delete().eq("id", id);
    fetchExpenses();
  };

  // ── Edit ────────────────────────────────────────────────
  const openEdit = (entry) => {
    setEditingEntry(entry);
    setEditAmount(String(entry.amount));
    setEditCategory(entry.category);
  };

  const saveEdit = async () => {
    if (!editAmount || !editCategory) return;
    await supabase.from("expenses").update({
      amount: parseFloat(editAmount),
      category: editCategory,
    }).eq("id", editingEntry.id);
    setEditingEntry(null);
    fetchExpenses();
  };

  // ── Filter & aggregate ───────────────────────────────────
  const filteredExpenses = expenses.filter(e =>
    (new Date() - new Date(e.created_at)) / (1000 * 60 * 60 * 24) <= filterDays
  );

  const categoryTotals = Object.values(
    filteredExpenses.reduce((acc, curr) => {
      if (!acc[curr.category]) acc[curr.category] = { name: curr.category, value: 0 };
      acc[curr.category].value += curr.amount;
      return acc;
    }, {})
  );

  const weeklyData = (() => {
    const weeks = {};
    filteredExpenses.forEach(e => {
      const daysAgo = Math.floor((new Date() - new Date(e.created_at)) / (1000 * 60 * 60 * 24));
      const weekNum = Math.floor(daysAgo / 7) + 1;
      const key = `Week ${weekNum}`;
      if (!weeks[key]) weeks[key] = { week: key, total: 0, order: weekNum };
      weeks[key].total += e.amount;
    });
    return Object.values(weeks).sort((a, b) => b.order - a.order);
  })();

  const totalSpend = filteredExpenses.reduce((s, e) => s + e.amount, 0);
  const avgSpend   = filteredExpenses.length > 0 ? totalSpend / filteredExpenses.length : 0;
  const topCategory = [...categoryTotals].sort((a, b) => b.value - a.value)[0];

  // ── Insights ─────────────────────────────────────────────
  const generateInsights = () => {
    if (filteredExpenses.length === 0) return ["No expense data for this period"];
    const ins = [];
    if (topCategory) {
      const pct = ((topCategory.value / totalSpend) * 100).toFixed(1);
      ins.push(`${topCategory.name} leads at ${pct}% of total spend`);
    }
    if (weeklyData.length >= 2) {
      const last = weeklyData[weeklyData.length - 1].total;
      const prev = weeklyData[weeklyData.length - 2].total;
      const change = ((last - prev) / prev) * 100;
      if (change > 10) ins.push(`Spending up ${change.toFixed(1)}% vs previous week`);
      else if (change < -10) ins.push(`Spending down ${Math.abs(change).toFixed(1)}% vs previous week`);
    }
    const spikes = filteredExpenses.filter(e => e.amount > avgSpend * 2);
    if (spikes.length > 0) ins.push(`${spikes.length} transaction${spikes.length > 1 ? "s" : ""} flagged as unusually high`);
    return ins;
  };

  const insights = generateInsights();

  // ── PDF Export ───────────────────────────────────────────
  const svgToDataURL = (containerRef) =>
    new Promise((resolve) => {
      const svg = containerRef.current.querySelector("svg");
      const serialized = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([serialized], { type: "image/svg+xml" });
      const url  = URL.createObjectURL(blob);
      const img  = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width  = svg.clientWidth  || 400;
        canvas.height = svg.clientHeight || 300;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = url;
    });

  const exportPDF = async () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Expense Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Last ${filterDays} days  |  Total ₹${totalSpend.toFixed(2)}`, 14, 22);
    doc.setFontSize(12);
    doc.text("Insights", 14, 32);
    doc.setFontSize(10);
    insights.forEach((ins, i) => doc.text(`- ${ins}`, 14, 38 + i * 6));
    const pieImg  = await svgToDataURL(pieRef);
    const lineImg = await svgToDataURL(lineRef);
    doc.addImage(pieImg,  "PNG", 14,  60, 80, 60);
    doc.addImage(lineImg, "PNG", 110, 60, 80, 60);
    doc.save("expense-report.pdf");
  };

  // ── UI ───────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "32px 24px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 40 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img src={logo} alt="EverydayBudget" style={{ height: 52, width: "auto", objectFit: "contain" }} />
            <div>
              <div style={{ fontSize: 11, letterSpacing: 4, color: C.accent, textTransform: "uppercase", marginBottom: 8 }}>
                Financial Intelligence
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: C.textPrimary, letterSpacing: "-0.5px" }}>
                Expense Analytics
              </h1>
              <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 4 }}>
                {new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              </div>
            </div>
          </div>

          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{user.user_metadata?.full_name || "User"}</div>
                <div style={{ fontSize: 11, color: C.textSecondary }}>{user.email}</div>
              </div>
              <button onClick={signOut} style={{
                background: "transparent",
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                color: C.textSecondary,
                padding: "8px 16px",
                fontSize: 13,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
                onMouseEnter={e => { e.target.style.borderColor = C.accent; e.target.style.color = C.accent; }}
                onMouseLeave={e => { e.target.style.borderColor = C.border; e.target.style.color = C.textSecondary; }}
              >Sign out</button>
            </div>
          ) : (
            <button onClick={signInWithGoogle} style={{
              background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
              border: "none",
              borderRadius: 12,
              color: "#fff",
              padding: "10px 22px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: 0.3,
            }}>
              Sign in with Google
            </button>
          )}
        </div>

        {/* ── Stat cards ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
          {[
            { label: "Total Spend", value: `₹${totalSpend.toFixed(2)}`, sub: `Last ${filterDays} days`, color: C.accent },
            { label: "Avg per Entry", value: `₹${avgSpend.toFixed(2)}`, sub: `${filteredExpenses.length} transactions`, color: C.purple },
            { label: "Top Category", value: topCategory?.name || "—", sub: topCategory ? `₹${topCategory.value.toFixed(2)}` : "No data", color: "#34d399" },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={{
              ...card,
              position: "relative",
              overflow: "hidden",
            }}>
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 2,
                background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
              }} />
              <div style={{ fontSize: 11, color: C.textSecondary, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color, letterSpacing: "-0.5px", marginBottom: 4 }}>{value}</div>
              <div style={{ fontSize: 12, color: C.textMuted }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ── Add expense + filter row ── */}
        <div style={{ ...card, marginBottom: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: C.textSecondary, textTransform: "uppercase", marginBottom: 20 }}>
            Log Expense
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              placeholder="Amount (₹)"
              value={amount}
              type="number"
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addExpense()}
              style={{
                flex: 1,
                minWidth: 140,
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                color: C.textPrimary,
                fontSize: 14,
                padding: "12px 16px",
                outline: "none",
              }}
            />
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{
                flex: 2,
                minWidth: 180,
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                color: category ? C.textPrimary : C.textSecondary,
                fontSize: 14,
                padding: "12px 16px",
                outline: "none",
                cursor: "pointer",
                appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 14px center",
              }}
            >
              <option value="" disabled>Category</option>
              {CATEGORIES.map(c => (
                <option key={c} value={c} style={{ background: C.card, color: C.textPrimary }}>{c}</option>
              ))}
            </select>
            <button onClick={addExpense} style={{
              background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
              border: "none",
              borderRadius: 10,
              color: "#fff",
              padding: "12px 28px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}>
              + Add
            </button>

            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setFilterDays(d)} style={{
                  background: filterDays === d ? C.accentDim : "transparent",
                  border: `1px solid ${filterDays === d ? C.accent : C.border}`,
                  borderRadius: 8,
                  color: filterDays === d ? C.accent : C.textSecondary,
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  letterSpacing: 0.5,
                  transition: "all 0.2s",
                }}>
                  {d}D
                </button>
              ))}
            </div>

            <button onClick={exportPDF} style={{
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: C.textSecondary,
              padding: "8px 18px",
              fontSize: 12,
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "all 0.2s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.purple; e.currentTarget.style.color = C.purple; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textSecondary; }}
            >
              Export PDF
            </button>
          </div>
        </div>

        {/* ── Charts row ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 16, marginBottom: 24 }}>
          {/* Pie chart */}
          <div style={card}>
            <div style={{ fontSize: 11, letterSpacing: 3, color: C.textSecondary, textTransform: "uppercase", marginBottom: 20 }}>
              Spend by Category
            </div>
            <div ref={pieRef} style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryTotals}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                  >
                    {categoryTotals.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", marginTop: 12 }}>
              {categoryTotals.map((c, i) => (
                <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.textSecondary }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[i % COLORS.length] }} />
                  {c.name}
                </div>
              ))}
            </div>
          </div>

          {/* Bar chart */}
          <div style={card}>
            <div style={{ fontSize: 11, letterSpacing: 3, color: C.textSecondary, textTransform: "uppercase", marginBottom: 20 }}>
              Weekly Spend
            </div>
            <div ref={lineRef} style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData} barSize={28}>
                  <XAxis
                    dataKey="week"
                    tick={{ fill: C.textSecondary, fontSize: 11 }}
                    axisLine={{ stroke: C.border }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: C.textSecondary, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={v => `₹${v}`}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: C.accentDim }} />
                  <Bar dataKey="total" fill="url(#barGrad)" radius={[6, 6, 0, 0]} />
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.accent} stopOpacity={0.9} />
                      <stop offset="100%" stopColor={C.purple} stopOpacity={0.6} />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ── Insights ── */}
        <div style={card}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: C.textSecondary, textTransform: "uppercase", marginBottom: 20 }}>
            AI Insights
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {insights.map((ins, i) => (
              <div key={i} style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "14px 16px",
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: COLORS[i % COLORS.length],
                  marginTop: 6, flexShrink: 0,
                }} />
                <div style={{ fontSize: 13, color: C.textPrimary, lineHeight: 1.6 }}>{ins}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Expense Log ── */}
        <div style={{ ...card, marginTop: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: C.textSecondary, textTransform: "uppercase", marginBottom: 20 }}>
            Expense Log
          </div>
          {filteredExpenses.length === 0 ? (
            <div style={{ textAlign: "center", color: C.textMuted, fontSize: 13, padding: "24px 0" }}>
              No entries for this period
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 0.8fr auto", gap: 12, padding: "0 12px", marginBottom: 4 }}>
                {["Date", "Category", "Amount", ""].map(h => (
                  <div key={h} style={{ fontSize: 10, letterSpacing: 2, color: C.textMuted, textTransform: "uppercase" }}>{h}</div>
                ))}
              </div>
              {filteredExpenses.map((e, i) => (
                <div key={e.id} style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1.4fr 0.8fr auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "12px 14px",
                  background: i % 2 === 0 ? C.surface : "transparent",
                  border: `1px solid ${i % 2 === 0 ? C.border : "transparent"}`,
                  borderRadius: 10,
                  transition: "border-color 0.2s",
                }}>
                  <div style={{ fontSize: 12, color: C.textSecondary }}>
                    {new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: COLORS[CATEGORIES.indexOf(e.category) % COLORS.length] || COLORS[0], flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: C.textPrimary }}>{e.category}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.accent }}>₹{Number(e.amount).toFixed(2)}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => openEdit(e)} style={{
                      background: "transparent",
                      border: `1px solid ${C.border}`,
                      borderRadius: 7,
                      color: C.purple,
                      padding: "5px 12px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}>Edit</button>
                    <button onClick={() => deleteExpense(e.id)} style={{
                      background: "transparent",
                      border: "1px solid rgba(248,113,113,0.2)",
                      borderRadius: 7,
                      color: "#f87171",
                      padding: "5px 12px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Edit Modal ── */}
        {editingEntry && (
          <div style={{
            position: "fixed", inset: 0,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 100,
          }} onClick={() => setEditingEntry(null)}>
            <div style={{
              ...card,
              width: 420,
              border: `1px solid ${C.borderHover}`,
            }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize: 11, letterSpacing: 3, color: C.textSecondary, textTransform: "uppercase", marginBottom: 20 }}>
                Edit Entry
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <input
                  type="number"
                  value={editAmount}
                  onChange={e => setEditAmount(e.target.value)}
                  placeholder="Amount (₹)"
                  style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    color: C.textPrimary,
                    fontSize: 14,
                    padding: "12px 16px",
                    outline: "none",
                  }}
                />
                <select
                  value={editCategory}
                  onChange={e => setEditCategory(e.target.value)}
                  style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    color: C.textPrimary,
                    fontSize: 14,
                    padding: "12px 16px",
                    outline: "none",
                    cursor: "pointer",
                    appearance: "none",
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 14px center",
                  }}
                >
                  {CATEGORIES.map(c => (
                    <option key={c} value={c} style={{ background: C.card }}>{c}</option>
                  ))}
                </select>
                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <button onClick={saveEdit} style={{
                    flex: 1,
                    background: `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
                    border: "none",
                    borderRadius: 10,
                    color: "#fff",
                    padding: "12px",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}>Save Changes</button>
                  <button onClick={() => setEditingEntry(null)} style={{
                    flex: 1,
                    background: "transparent",
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    color: C.textSecondary,
                    padding: "12px",
                    fontSize: 14,
                    cursor: "pointer",
                  }}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div style={{ textAlign: "center", marginTop: 40, fontSize: 11, color: C.textMuted, letterSpacing: 1 }}>
          EVERYDAY BUDGET &nbsp;·&nbsp; FINANCIAL INTELLIGENCE PLATFORM
        </div>

      </div>
    </div>
  );
}
