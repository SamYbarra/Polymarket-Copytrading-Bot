import { getApiBase } from "@/lib/api";
import { API_ENDPOINTS } from "@/lib/endpoints";

export function ApiPage() {
  const base = getApiBase();

  return (
    <div>
      <h1 className="page-title">API endpoints</h1>
      <p className="page-desc">
        Frontend calls and corresponding backend (NestJS <code>TrackerController</code>).
        Base: <span className="mono">{base}</span>
      </p>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Query</th>
                <th>Description</th>
                <th>Backend</th>
              </tr>
            </thead>
            <tbody>
              {API_ENDPOINTS.map((e) => (
                <tr key={e.path}>
                  <td className="mono">{e.method}</td>
                  <td className="mono">
                    <a href={`${base}${e.path}`} target="_blank" rel="noopener noreferrer">
                      {e.path}
                    </a>
                  </td>
                  <td className="mono muted">
                    {e.query?.length ? e.query.join(", ") : "—"}
                  </td>
                  <td>{e.description}</td>
                  <td className="mono" style={{ fontSize: "0.85rem" }}>
                    {e.backendHandler}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
