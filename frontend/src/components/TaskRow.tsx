import { CSSProperties, memo } from "react";
import { Task, TaskBlock, Project } from "../api";
import { TaskCheck } from "./primitives";
import { Icon } from "./Icon";
import { toggleTaskDone } from "../store";
import { repeatLabel } from "../lib/derive";
import { fmtDuration, fmtTime, minutesOfIso, relDay, todayIso } from "../dates";

// One task in a list. Clicking opens it; the checkbox completes it.
export const TaskRow = memo(function TaskRow({
  task, project, block, showProject = true, selected, focused, onOpen, onSelect, hideDate,
}: {
  task: Task;
  project?: Project;
  block?: TaskBlock;
  showProject?: boolean;
  selected?: boolean;
  focused?: boolean;
  hideDate?: string; // don't repeat the deadline when it equals the group's date
  onOpen: (task: Task) => void;
  onSelect?: (task: Task, e: React.MouseEvent) => void;
}) {
  const today = todayIso();
  const overdue = task.deadline && task.deadline < today && !task.done;
  const blockDay = block?.start_at.slice(0, 10);
  return (
    <div className={"task-row" + (task.done ? " is-done" : "") + (selected ? " selected" : "") + (focused ? " focused" : "") + (task.id < 0 ? " saving" : "")}
      data-task-row={task.id} role="listitem"
      onClick={(e) => {
        if (onSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); onSelect(task, e); return; }
        onOpen(task);
      }}>
      <TaskCheck done={task.done} priority={task.priority} onToggle={() => toggleTaskDone(task)}
        label={task.done ? `Mark “${task.title}” not done` : `Complete “${task.title}”`} />
      <div className="task-main">
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {block && (
            <span className="meta scheduled">
              <Icon name="calendar" size={12} />
              {blockDay === hideDate ? "" : relDay(blockDay!) + " "}{fmtTime(minutesOfIso(block.start_at), true)}
            </span>
          )}
          {task.deadline && task.deadline !== hideDate && (
            <span className={"meta" + (overdue ? " danger" : task.deadline === today ? " warn" : "")}>
              <Icon name="flag" size={12} />{relDay(task.deadline)}
            </span>
          )}
          {task.repeat_every && task.repeat_unit && (
            <span className="meta" title={repeatLabel(task.repeat_every, task.repeat_unit)}><Icon name="repeat" size={12} /></span>
          )}
          {task.duration_minutes && <span className="meta"><Icon name="clock" size={12} />{fmtDuration(task.duration_minutes)}</span>}
          {task.notes && <span className="meta" title="Has notes"><Icon name="list" size={12} /></span>}
        </span>
      </div>
      {showProject && project && (
        <span className="task-project" style={{ "--c": project.color } as CSSProperties}>
          <span className="dot" />{project.name}
        </span>
      )}
    </div>
  );
});
