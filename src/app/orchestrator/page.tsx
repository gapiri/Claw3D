import { OrchestratorPanel } from "@/components/orchestrator/OrchestratorPanel";

export const metadata = {
  title: "Orchestrator — Claw3D",
  description: "Nova Go local orchestrator control panel",
};

export default function OrchestratorPage() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#06090d]">
      <OrchestratorPanel />
    </div>
  );
}
