import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Dashboard" },
  { to: "/wallets", label: "Top traders" },
  { to: "/predictions", label: "Predictions" },
  { to: "/api", label: "API" },
];

export function Nav() {
  return (
    <nav className="nav">
      <NavLink to="/" className="nav-brand">
        BTC 5m
      </NavLink>
      <ul className="nav-links">
        {links.map(({ to, label }) => (
          <li key={to}>
            <NavLink to={to} className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}>
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
