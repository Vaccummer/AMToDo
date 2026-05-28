import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { useConfirm } from "./ConfirmDialog";

interface DirectoryPickerModalProps {
  filename: string;
  cacheRelPath: string;
  onClose: () => void;
  onSaved: () => void;
}

const LAST_PATH_KEY = "dirpicker_last_path";

interface DirEntry {
  name: string;
  type: "directory" | "file";
}

export function DirectoryPickerModal({ filename, cacheRelPath, onClose, onSaved }: DirectoryPickerModalProps) {
  const { t } = useI18n();
  const { ask, dialog: confirmDialog } = useConfirm();

  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editFilename, setEditFilename] = useState(filename);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [saving, setSaving] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closedViaPopRef = useRef(false);

  useEffect(() => {
    history.pushState({ modal: "directory-picker" }, "");
    const onPopState = () => {
      closedViaPopRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (!closedViaPopRef.current) history.back();
    };
  }, []);

  // Listen for close event from parent's back gesture handler
  useEffect(() => {
    const handleClose = () => onCloseRef.current();
    window.addEventListener("dirpicker-close", handleClose);
    return () => window.removeEventListener("dirpicker-close", handleClose);
  }, []);

  // Load directory listing
  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await Filesystem.readdir({ path: path || ".", directory: Directory.ExternalStorage });
      const dirs = result.files
        .filter((f) => f.type === "directory")
        .sort((a, b) => a.name.localeCompare(b.name));
      setEntries(dirs);
      setCurrentPath(path);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.operationFailed"));
      // If we can't read the directory, go up or show root
      if (path) {
        try {
          const rootResult = await Filesystem.readdir({ path: ".", directory: Directory.ExternalStorage });
          const dirs = rootResult.files
            .filter((f) => f.type === "directory")
            .sort((a, b) => a.name.localeCompare(b.name));
          setEntries(dirs);
          setCurrentPath("");
        } catch {
          setPermissionDenied(true);
        }
      } else {
        setPermissionDenied(true);
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Initialize: check permissions, restore last path, load directory
  useEffect(() => {
    (async () => {
      try {
        const permStatus = await Filesystem.checkPermissions();
        if (permStatus.publicStorage !== "granted") {
          const result = await Filesystem.requestPermissions();
          if (result.publicStorage !== "granted") {
            setPermissionDenied(true);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Permission check not available (web?) — proceed
      }

      // Try to restore last path
      try {
        const { value: lastPath } = await Preferences.get({ key: LAST_PATH_KEY });
        if (lastPath) {
          try {
            await Filesystem.stat({ path: lastPath, directory: Directory.ExternalStorage });
            await loadDir(lastPath);
            return;
          } catch {
            // Last path no longer exists, fall through to root
          }
        }
      } catch {
        // Preferences not available
      }

      await loadDir("");
    })();
  }, [loadDir]);

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  function navigateTo(path: string) {
    loadDir(path);
  }

  function navigateUp() {
    if (!currentPath) return;
    const parts = currentPath.split("/");
    parts.pop();
    navigateTo(parts.join("/"));
  }

  // Breadcrumb segments
  const pathSegments = currentPath ? currentPath.split("/") : [];

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const newPath = currentPath ? `${currentPath}/${name}` : name;
      await Filesystem.mkdir({ path: newPath, directory: Directory.ExternalStorage, recursive: true });
      setCreatingFolder(false);
      setNewFolderName("");
      await loadDir(currentPath);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.operationFailed"));
    }
  }

  async function handleSave() {
    const name = editFilename.trim();
    if (!name) return;
    setSaving(true);
    setError(null);

    try {
      const targetPath = currentPath ? `${currentPath}/${name}` : name;

      // Conflict check
      try {
        await Filesystem.stat({ path: targetPath, directory: Directory.ExternalStorage });
        // File exists — ask for confirmation
        const ok = await ask({
          title: t("common.fileExistsConfirm", { name }),
          message: "",
          confirmLabel: t("common.save"),
          danger: true,
        });
        if (!ok) {
          setSaving(false);
          return;
        }
      } catch {
        // stat failed = file doesn't exist = OK to proceed
      }

      // Ensure parent directory exists
      if (currentPath) {
        try {
          await Filesystem.stat({ path: currentPath, directory: Directory.ExternalStorage });
        } catch {
          await Filesystem.mkdir({ path: currentPath, directory: Directory.ExternalStorage, recursive: true });
        }
      }

      // Copy file
      await Filesystem.copy({
        from: cacheRelPath,
        to: targetPath,
        directory: Directory.Cache,
        toDirectory: Directory.ExternalStorage,
      });

      // Remember path for next time
      await Preferences.set({ key: LAST_PATH_KEY, value: currentPath });

      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function handleShareFallback() {
    // Use Web Share API as fallback when storage permission is denied
    (async () => {
      try {
        const { data } = await Filesystem.readFile({ path: cacheRelPath, directory: Directory.Cache });
        const binaryStr = atob(data as string);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/octet-stream" });
        const file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          onSaved();
        }
      } catch {
        // User cancelled or share failed
      }
    })();
  }

  return (
    <div className="dirpicker-backdrop" onClick={handleBackdrop} onKeyDown={handleKeyDown}>
      <div className="dirpicker-card" role="dialog" aria-label={t("common.selectSavePath")}>
        {/* Header */}
        <div className="dirpicker-header">
          <h2 className="dirpicker-title">{t("common.selectSavePath")}</h2>
          <button type="button" className="dirpicker-close" onClick={onClose} aria-label={t("common.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {permissionDenied ? (
          <div className="dirpicker-body">
            <div className="dirpicker-permission-denied">
              <p>{t("common.storagePermissionDenied")}</p>
              <button type="button" className="dirpicker-share-btn" onClick={handleShareFallback}>
                {t("common.saveFile")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Path breadcrumb */}
            <div className="dirpicker-pathbar">
              <button
                type="button"
                className={`dirpicker-path-segment${!currentPath ? " active" : ""}`}
                onClick={() => navigateTo("")}
              >
                {t("common.internalStorage")}
              </button>
              {pathSegments.map((seg, i) => (
                <span key={i}>
                  <span className="dirpicker-path-sep">/</span>
                  <button
                    type="button"
                    className={`dirpicker-path-segment${i === pathSegments.length - 1 ? " active" : ""}`}
                    onClick={() => navigateTo(pathSegments.slice(0, i + 1).join("/"))}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>

            {/* Directory listing */}
            <div className="dirpicker-body">
              {error ? <div className="dirpicker-error">{error}</div> : null}

              {loading ? (
                <div className="dirpicker-loading">
                  <div className="dirpicker-spinner" />
                </div>
              ) : (
                <div className="dirpicker-list">
                  {currentPath && (
                    <button type="button" className="dirpicker-entry" onClick={navigateUp}>
                      <svg className="dirpicker-entry-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 18l-6-6 6-6" />
                      </svg>
                      <span className="dirpicker-entry-name">..</span>
                    </button>
                  )}
                  {entries.map((entry) => (
                    <button
                      type="button"
                      key={entry.name}
                      className="dirpicker-entry"
                      onClick={() => navigateTo(currentPath ? `${currentPath}/${entry.name}` : entry.name)}
                    >
                      <svg className="dirpicker-entry-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      <span className="dirpicker-entry-name">{entry.name}</span>
                    </button>
                  ))}
                  {entries.length === 0 && !currentPath && (
                    <div className="dirpicker-empty">{t("common.loading")}</div>
                  )}

                  {/* New folder input */}
                  {creatingFolder ? (
                    <div className="dirpicker-newfolder">
                      <input
                        type="text"
                        className="dirpicker-newfolder-input"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder={t("common.folderName")}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateFolder();
                          if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
                        }}
                      />
                      <button type="button" className="dirpicker-newfolder-confirm" onClick={handleCreateFolder}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                      <button type="button" className="dirpicker-newfolder-cancel" onClick={() => { setCreatingFolder(false); setNewFolderName(""); }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="dirpicker-entry dirpicker-newfolder-btn" onClick={() => setCreatingFolder(true)}>
                      <svg className="dirpicker-entry-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span className="dirpicker-entry-name">{t("common.newFolder")}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Footer: save path + filename + save */}
            <div className="dirpicker-footer">
              <div className="dirpicker-save-path">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span className="dirpicker-save-path-text">
                  {t("common.internalStorage")}{currentPath ? ` / ${currentPath.replace(/\//g, " / ")}` : ""}
                </span>
              </div>
              <div className="dirpicker-save-row">
                <input
                  type="text"
                  className="dirpicker-filename-input"
                  value={editFilename}
                  onChange={(e) => setEditFilename(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                  placeholder={t("common.filename")}
                />
                <button
                  type="button"
                  className="dirpicker-save-btn"
                  disabled={saving || !editFilename.trim()}
                  onClick={handleSave}
                >
                  <svg width="25" height="25" viewBox="0 0 1024 1024" aria-hidden="true">
                    <path d="M576.2 303.2c17.7 0 32.1-14.5 32.1-32.1V239c0-17.7-14.5-32.1-32.1-32.1s-32.1 14.5-32.1 32.1v32.1c0 17.7 14.5 32.1 32.1 32.1z" fill="#FFFFFF" />
                    <path d="M919.9 232.6L791.4 104.1c-6.4-6.4-14.5-9.6-22.5-9.6H190.8c-53 0-96.4 43.4-96.4 96.4v642.3c0 53 43.4 96.4 96.4 96.4h642.4c53 0 96.4-43.4 96.4-96.4V255.1c-0.1-8.1-3.3-16.1-9.7-22.5z m-263.4-73.9v171.8c0 11.2-9.6 20.9-20.9 20.9H388.3c-11.2 0-20.9-9.6-20.9-20.9V158.7h289.1zM319.3 865.3V643.7c0-19.3 16.1-35.3 35.3-35.3h314.7c19.3 0 35.3 16.1 35.3 35.3v221.6H319.3z m546-32.1c0 17.7-14.5 32.1-32.1 32.1h-62.6V643.7c0-54.6-45-99.6-99.6-99.6H354.6c-54.6 0-99.6 45-99.6 99.6v221.6h-64.2c-17.7 0-32.1-14.5-32.1-32.1V190.8c0-17.7 14.5-32.1 32.1-32.1h112.4v171.8c0 46.6 38.5 85.1 85.1 85.1h247.3c46.6 0 85.1-38.5 85.1-85.1V158.7H756l109.2 109.2v565.3z" fill="#FFFFFF" />
                  </svg>
                </button>
              </div>
            </div>
            {saving ? <div className="modal-save-progress" /> : null}
          </>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}
