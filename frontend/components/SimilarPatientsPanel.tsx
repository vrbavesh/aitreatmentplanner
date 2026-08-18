"use client";
// LLD v2 §9 — read-only similar patients panel (pgvector similarity results).
export interface SimilarityMatch {
  matched_patient_id: string;
  similarity_score: number;
  approved_treatment?: string | null;
  outcome_notes?: string | null;
}

interface SimilarPatientsPanelProps {
  matches: SimilarityMatch[];
}

export default function SimilarPatientsPanel({ matches }: SimilarPatientsPanelProps) {
  return (
    <section>
      <h2>Similar Patients</h2>
      {matches.length === 0 ? (
        <p>No similar patients found.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Similarity</th>
              <th>Approved treatment</th>
              <th>Outcome notes</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.matched_patient_id}>
                <td>{m.matched_patient_id}</td>
                <td>{m.similarity_score.toFixed(2)}</td>
                <td>{m.approved_treatment ?? "—"}</td>
                <td>{m.outcome_notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}