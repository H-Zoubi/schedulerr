import { Dialog, SheetHeader } from "./primitives";
import { ScopeRequest } from "../lib/ui";

// "This one / This and following / All" for a change to a recurring routine.
export function ScopeDialog({ request }: { request: ScopeRequest }) {
  const cancel = () => request.resolve(null);
  return (
    <Dialog onClose={cancel} label={request.title} className="scope-sheet">
      <SheetHeader title={request.title} onClose={cancel} />
      <div className="scope-options">
        <button className="btn" data-autofocus onClick={() => request.resolve("one")}>{request.verb} this one</button>
        <button className="btn" onClick={() => request.resolve("following")}>{request.verb} this and following</button>
        <button className="btn" onClick={() => request.resolve("all")}>{request.verb} all</button>
        <button className="btn ghost" onClick={cancel}>Cancel</button>
      </div>
    </Dialog>
  );
}
