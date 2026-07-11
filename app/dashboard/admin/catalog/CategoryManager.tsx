"use client";

import { useActionState } from "react";
import {
  FormFeedback,
  SubmitButton,
  inputCls,
  type Feedback,
} from "../../_components/forms";
import {
  createCategory,
  renameCategory,
  deleteCategory,
  type CategoryState,
  type CategoryKind,
} from "./category-actions";

interface Category {
  id: string;
  name: string;
}

interface Props {
  kind: CategoryKind;
  categories: Category[];
  title: string;
}

function toFeedback(state: CategoryState | undefined): Feedback | null {
  if (state?.error) return { type: "error", message: state.error };
  if (state?.success) return { type: "success", message: state.success };
  return null;
}

function CategoryRow({ category }: { category: Category }) {
  const [renameState, renameAction, renamePending] = useActionState<
    CategoryState | undefined,
    FormData
  >(renameCategory, undefined);
  const [deleteState, deleteAction, deletePending] = useActionState<
    CategoryState | undefined,
    FormData
  >(deleteCategory, undefined);

  const error = renameState?.error ?? deleteState?.error ?? null;

  return (
    <li className="py-1.5">
      <div className="flex items-center gap-2">
        {/* key remount per success — the input's defaultValue must re-seed
            from the freshly revalidated name, never via setState in effects. */}
        <form
          key={renameState?.token ?? "init"}
          action={renameAction}
          className="flex flex-1 items-center gap-2"
        >
          <input type="hidden" name="category_id" value={category.id} />
          <input
            name="name"
            defaultValue={category.name}
            required
            aria-label={`Rename ${category.name}`}
            className={`${inputCls} !py-1.5 text-sm`}
          />
          <button
            type="submit"
            disabled={renamePending}
            className="shrink-0 rounded-lg border border-[#d9d1c1] bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-700 transition hover:text-indigo-500 disabled:opacity-50"
          >
            {renamePending ? "Saving…" : "Rename"}
          </button>
        </form>
        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (!confirm(`Delete category "${category.name}"?`)) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="category_id" value={category.id} />
          <button
            type="submit"
            disabled={deletePending}
            aria-label={`Delete ${category.name}`}
            title={`Delete ${category.name}`}
            className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-neutral-500 transition hover:text-red-600 disabled:opacity-50"
          >
            ✕
          </button>
        </form>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </li>
  );
}

/** Compact card to create / rename / delete managed categories of one kind. */
export default function CategoryManager({ kind, categories, title }: Props) {
  const [state, formAction, pending] = useActionState<
    CategoryState | undefined,
    FormData
  >(createCategory, undefined);

  return (
    <div className="rounded-lg border border-[#e6e0d3] bg-[#f7f3ec] p-5">
      <h3 className="text-sm font-semibold text-neutral-900">
        {title}{" "}
        <span className="ml-1 font-normal text-neutral-500">
          {categories.length}
        </span>
      </h3>

      {/* key remount per success clears the input without effect-driven resets. */}
      <form
        key={state?.token ?? "init"}
        action={formAction}
        className="mt-3 flex items-start gap-2"
      >
        <input type="hidden" name="kind" value={kind} />
        <input
          name="name"
          required
          placeholder="New category name"
          className={inputCls}
        />
        <div className="w-28 shrink-0">
          <SubmitButton pending={pending} pendingLabel="Adding…">
            Add
          </SubmitButton>
        </div>
      </form>
      <div className="mt-2">
        <FormFeedback feedback={toFeedback(state)} />
      </div>

      {categories.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">No categories yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#e6e0d3]">
          {categories.map((c) => (
            <CategoryRow key={c.id} category={c} />
          ))}
        </ul>
      )}
    </div>
  );
}
