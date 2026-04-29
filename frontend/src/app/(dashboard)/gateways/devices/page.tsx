"use client";

import { useEffect, useState } from "react";
import { Check, X, Shield, RefreshCw } from "lucide-react";
import { DashboardPageLayout } from "@/components/templates/DashboardPageLayout";
import { useListBoardsApiV1BoardsGet } from "@/api/generated/boards/boards";
import { useAuth } from "@/auth/clerk";

export default function DevicesPage() {
  const { isSignedIn } = useAuth();
  const { data: boardsData, isLoading: isLoadingBoards } = useListBoardsApiV1BoardsGet(
    undefined,
    { query: { enabled: Boolean(isSignedIn) } }
  );

  const boards = boardsData?.status === 200 ? (boardsData.data.items ?? []) : [];
  const [selectedBoardId, setSelectedBoardId] = useState<string>("");
  const [devices, setDevices] = useState<any[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (boards.length > 0 && !selectedBoardId) {
      setSelectedBoardId(boards[0].id);
    }
  }, [boards, selectedBoardId]);

  const fetchDevices = async () => {
    if (!selectedBoardId) return;
    setIsLoadingDevices(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/gateways/devices?board_id=${selectedBoardId}`, {
        // Next.js will automatically send cookies for same-origin requests
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch devices: ${response.statusText}`);
      }
      const data = await response.json();
      setDevices(data.devices || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [selectedBoardId]);

  const handleAction = async (requestId: string, action: "approve" | "reject") => {
    try {
      const response = await fetch(`/api/v1/gateways/devices/${requestId}/${action}?board_id=${selectedBoardId}`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(`Failed to ${action} device`);
      // Refresh list
      await fetchDevices();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  return (
    <DashboardPageLayout
      title="Gateway Devices"
      signedOut={{
        message: "Sign in to manage devices.",
        forceRedirectUrl: "/gateways/devices",
      }}
    >
      <div className="flex flex-col max-w-4xl mx-auto w-full">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-indigo-500" />
            <span className="font-semibold text-slate-800 dark:text-slate-200">Device Pairing</span>
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500 font-medium">Select Board:</span>
            {isLoadingBoards ? (
              <span className="text-sm text-slate-400">Loading boards...</span>
            ) : (
              <select
                value={selectedBoardId}
                onChange={(e) => setSelectedBoardId(e.target.value)}
                className="text-sm border border-slate-300 dark:border-slate-700 rounded-md bg-transparent text-slate-700 dark:text-slate-300 py-1.5 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            )}
            <button 
              onClick={fetchDevices}
              className="p-1.5 text-slate-500 hover:text-indigo-600 transition-colors bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-md"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingDevices ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-lg">
            Error: {error}
          </div>
        )}

        {/* Devices List */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-medium text-slate-800 dark:text-slate-200">Pending Requests</h3>
          </div>
          
          {isLoadingDevices && devices.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">Loading pending devices...</div>
          ) : devices.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No pending pairing requests found for this gateway.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {devices.map((device) => (
                <li key={device.requestId} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {device.device?.name || "Unknown Device"}
                      </span>
                      <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 px-2 py-0.5 rounded-full font-mono">
                        {device.device?.id?.substring(0, 8)}...
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 font-mono">Request ID: {device.requestId}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAction(device.requestId, "reject")}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors"
                    >
                      <X className="w-4 h-4" /> Reject
                    </button>
                    <button
                      onClick={() => handleAction(device.requestId, "approve")}
                      className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm transition-colors"
                    >
                      <Check className="w-4 h-4" /> Approve
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardPageLayout>
  );
}
