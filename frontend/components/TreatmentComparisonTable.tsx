"use client";
// LLD v2 §9 — read-only treatment prediction table.
// Single-treatment display per current scope (HLD §0.2 — no cross-treatment ranking UI).
export interface TreatmentPrediction {
  treatment_name: string;
  risk_band: "low" | "medium" | "high";
  success_band: "low" | "medium" | "high";
  side_effect_band: "low" | "medium" | "high";
  improvement_band: "low" | "medium" | "high";
  confidence_score: number;
  explanation: string;
  rule_id: string;
}

interface TreatmentComparisonTableProps {
  predictions: TreatmentPrediction[];
}

export default function TreatmentComparisonTable({
  predictions,
}: TreatmentComparisonTableProps) {
  if (predictions.length === 0) {
    return (
      <section>
        <h2>Suggested Treatment</h2>
        <p>No treatment predictions available.</p>
      </section>
    );
  }
  return (
    <section>
      <h2>Suggested Treatment</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Treatment</th>
            <th>Risk</th>
            <th>Success</th>
            <th>Side effects</th>
            <th>Improvement</th>
            <th>Confidence</th>
            <th>Rule</th>
            <th>Explanation</th>
          </tr>
        </thead>
        <tbody>
          {predictions.map((p) => (
            <tr key={p.rule_id}>
              <td>{p.treatment_name}</td>
              <td>{p.risk_band}</td>
              <td>{p.success_band}</td>
              <td>{p.side_effect_band}</td>
              <td>{p.improvement_band}</td>
              <td>{p.confidence_score.toFixed(2)}</td>
              <td>{p.rule_id}</td>
              <td>{p.explanation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}