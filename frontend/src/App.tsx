import { Routes, Route } from "react-router-dom";
import { Nav } from "./components/Nav";
import { DashboardPage } from "./pages/DashboardPage";
import { WalletsPage } from "./pages/WalletsPage";
import { PredictionsPage } from "./pages/PredictionsPage";
import { ApiPage } from "./pages/ApiPage";

export default function App() {
  return (
    <>
      <Nav />
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/wallets" element={<WalletsPage />} />
          <Route path="/predictions" element={<PredictionsPage />} />
          <Route path="/api" element={<ApiPage />} />
        </Routes>
      </main>
    </>
  );
}
