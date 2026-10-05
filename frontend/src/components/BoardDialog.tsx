import { FormEvent, useState } from "react";
import { ColorPicker, Dialog, PROJECT_COLORS, SheetHeader } from "./primitives";
import { Project } from "../api";
import { createProject, deleteProject, updateProject } from "../store";
import { navigate } from "../lib/router";

// Create a board, or edit one (name, colour, deadline) when `project` is given.
export function BoardDialog({ project, onClose }: { project?: Project; onClose: () => void }) {
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[Math.floor(Math.random() * 8)]);
  const [deadline, setDeadline] = useState(project?.deadline ?? "");
  const [confirming, setConfirming] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (project) {
      updateProject(project.id, { name: n, color, deadline: deadline || null }).catch(() => undefined);
    } else {
      const created = createProject(n, color, deadline || null);
      navigate({ name: "board", id: created.id });
    }
    onClose();
  }

  return (
    <Dialog onClose={onClose} label={project ? "Board settings" : "New board"}>
      <SheetHeader title={project ? "Board settings" : "New board"} onClose={onClose} />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} maxLength={200} placeholder="Thesis, Side project, Home…"
            onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field">
          <span>Colour</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
        <label className="field">
          <span>Deadline <em className="muted">optional</em></span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <div className="form-actions">
          {project && !confirming && (
            <button type="button" className="btn ghost danger" onClick={() => setConfirming(true)}>Delete board</button>
          )}
          {project && confirming && (
            <button type="button" className="btn danger-solid" onClick={() => {
              deleteProject(project.id);
              navigate({ name: "board", id: null });
              onClose();
            }}>Delete — tasks move to General</button>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()}>{project ? "Save" : "Create board"}</button>
        </div>
      </form>
    </Dialog>
  );
}
