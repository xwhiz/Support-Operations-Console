import { ArrowLeft, ArrowRight } from "lucide-react";
import { buttonClass } from "./Button";
import { cn } from "@/lib/cn";

export function Pagination({
  page,
  pageCount,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-gray-200 px-5 py-3">
      <p className="text-sm text-gray-600">
        Page <span className="font-medium text-gray-900">{page}</span> of{" "}
        <span className="font-medium text-gray-900">{pageCount}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={page <= 1}
          className={cn(buttonClass("secondary", "sm"))}
        >
          <ArrowLeft className="h-4 w-4" /> Previous
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= pageCount}
          className={cn(buttonClass("secondary", "sm"))}
        >
          Next <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
