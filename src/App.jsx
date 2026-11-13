import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import InitializationScreen from "./pages/InitializationScreen";
import Dashboard from "./pages/Dashboard";
import MapScreen from "./pages/MapScreen";
import IntelligenceWorkspace from "./pages/IntelligenceWorkspace";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/initialize" element={<InitializationScreen />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/map" element={<MapScreen />} />
        <Route path="/intelligence" element={<IntelligenceWorkspace />} />
      </Routes>
    </Router>
  );
}







export default App;
