import { useRef, useState } from 'react';

interface Props {
  fonts: { id: string; name: string }[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onImport: (files: FileList) => void;
}

export default function FontTabs({
  fonts,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onDuplicate,
  onReorder,
  onImport,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setDraftName(name);
  };
  const commitEdit = () => {
    if (editingId) {
      const name = draftName.trim();
      if (name) onRename(editingId, name);
    }
    setEditingId(null);
  };

  return (
    <div className="font-tabs">
      {fonts.map((f, i) => {
        const active = f.id === activeId;
        const editing = editingId === f.id;
        return (
          <div
            key={f.id}
            className={
              'font-tab' + (active ? ' is-active' : '') + (dropIdx === i ? ' drop-before' : '')
            }
            draggable={!editing}
            onDragStart={(e) => {
              dragFrom.current = i;
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDropIdx(i);
            }}
            onDragLeave={() => setDropIdx((d) => (d === i ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragFrom.current;
              setDropIdx(null);
              dragFrom.current = null;
              if (from != null && from !== i) onReorder(from, i);
            }}
            onDragEnd={() => {
              setDropIdx(null);
              dragFrom.current = null;
            }}
            onClick={() => !editing && onSelect(f.id)}
            title={f.name}
          >
            {editing ? (
              <input
                className="font-tab-input"
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  else if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="font-tab-name"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEdit(f.id, f.name);
                }}
              >
                {f.name || 'Untitled'}
              </span>
            )}
            {!editing && (
              <>
                <button
                  className="font-tab-btn"
                  title="Duplicate this font"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(f.id);
                  }}
                >
                  ⧉
                </button>
                <button
                  className="font-tab-btn font-tab-close"
                  title="Delete this font"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(f.id);
                  }}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        );
      })}
      <button className="font-tab-add" title="New font" onClick={onAdd}>
        ＋
      </button>
      <button
        className="font-tab-add"
        title="Import one or more .stitchfont.json files as new tabs"
        onClick={() => fileRef.current?.click()}
      >
        ⤓ Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files && e.target.files.length) onImport(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
