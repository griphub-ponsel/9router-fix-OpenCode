"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

/**
 * Codex Session Import Modal
 * Paste Codex token/session JSON to import accounts without OAuth/phone verification.
 * Accepts: { accessToken, refreshToken, idToken }, { accounts: [...] }, or legacy
 * chatgpt.com/api/auth/session JSON.
 */
export default function CodexSessionImportModal({ isOpen, onSuccess, onClose }) {
  const [sessionText, setSessionText] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);

  const handleImport = async () => {
    setError(null);
    setResults(null);

    const trimmed = sessionText.trim();
    if (!trimmed) {
      setError("Please paste session JSON");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      setError("Invalid JSON. Paste Codex token JSON or the content from chatgpt.com/api/auth/session.");
      return;
    }

    const sessions = Array.isArray(parsed)
      ? parsed
      : (parsed?.accounts || parsed?.sessions || [parsed]);
    const hasToken = sessions.some((s) => s.accessToken || s.access_token);
    if (!hasToken) {
      setError("No accessToken found in JSON. Please check again.");
      return;
    }

    setImporting(true);
    try {
      const res = await fetch("/api/oauth/codex/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: sessions }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      setResults(data);
      if (data.success > 0) {
        onSuccess?.();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setSessionText("");
    setError(null);
    setResults(null);
    onClose?.();
  };

  return (
    <Modal isOpen={isOpen} title="Import Codex Accounts" onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {/* Instructions */}
        <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>Import Codex accounts by pasting token JSON from Codex/ChatGPT session tooling.</p>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">Supported JSON:</p>
            <ol className="list-decimal list-inside space-y-1 text-blue-700 dark:text-blue-300 text-xs">
              <li>Preferred: <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">accessToken</code>, <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">refreshToken</code>, and <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">idToken</code></li>
              <li>Bulk: paste an array or <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">&#123; &quot;accounts&quot;: [...] &#125;</code></li>
              <li>Legacy fallback: <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">chatgpt.com/api/auth/session</code> JSON</li>
            </ol>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Legacy ChatGPT session imports usually have no refresh token, so they can expire. Token JSON with refreshToken is recommended.
          </p>
        </div>

        {/* Textarea */}
        <textarea
          className="w-full h-48 p-3 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder='[{"accessToken":"eyJ...","refreshToken":"rt_...","idToken":"eyJ...","email":"user@example.com"}]'
          value={sessionText}
          onChange={(e) => setSessionText(e.target.value)}
          disabled={importing}
        />

        {/* Error */}
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            {error}
          </div>
        )}

        {/* Results */}
        {results && (
          <div className={`text-sm rounded-lg p-3 border ${results.success > 0 ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300" : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"}`}>
            <p className="font-medium mb-1">
              {results.success > 0 ? "Import completed" : "Import failed"}
            </p>
            {results.success > 0 && (
              <p>Imported: {results.success} account(s)</p>
            )}
            {results.failed > 0 && <p>Failed: {results.failed} account(s)</p>}
            {results.results?.map((item) => item.ok ? (
              <p key={item.index} className="text-xs mt-1">#{item.index + 1}: {item.email || "Imported"}</p>
            ) : (
              <p key={item.index} className="text-xs mt-1 text-red-600 dark:text-red-400">#{item.index + 1}: {item.error}</p>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={handleClose} disabled={importing}>
            {results?.success > 0 ? "Close" : "Cancel"}
          </Button>
          {!(results?.success > 0) && (
            <Button onClick={handleImport} disabled={importing || !sessionText.trim()}>
              {importing ? "Importing..." : "Import"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

CodexSessionImportModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func,
};
