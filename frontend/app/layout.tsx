import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "AI-Assisted Treatment Recommendation System",
  description: "Upload → Extract → Predict → Doctor Approves → Patient Sees Plan",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/patient/dashboard">Patient</a> <a href="/doctor/queue">Doctor</a>{" "}
          <a href="/login">Login</a> <a href="/signup">Signup</a>
        </nav>
        <main>{children}</main>
        <style>{`
          body { font-family: system-ui, sans-serif; margin: 0; }
          nav { padding: 0.75rem 1rem; background: #111; color: #fff; }
          nav a { color: #fff; margin-right: 1rem; }
          main { padding: 1rem; max-width: 900px; }
          .form label { display: block; margin: 0.5rem 0; }
          .form input[type="text"], .form input[type="number"], .form select,
          .form textarea { display: block; width: 100%; max-width: 400px; }
          .table { border-collapse: collapse; width: 100%; }
          .table th, .table td { border: 1px solid #ccc; padding: 0.4rem; text-align: left; }
          .error { color: #b00020; }
          .success { color: #1b7f3b; }
        `}</style>
      </body>
    </html>
  );
}