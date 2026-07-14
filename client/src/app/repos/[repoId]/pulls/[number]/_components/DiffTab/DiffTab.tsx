"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "./_components/SmartDiffViewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { PrFile, ReviewRecord } from "@devdigest/shared";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Already-fetched reviews (the page already loads these for FindingsTab) —
     Smart Diff reads them only to color each line's inline severity badge;
     the "N finding-lines" count stays sourced from the smart-diff response. */
  reviews: ReviewRecord[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Fired with a finding's id when a Smart Diff per-line severity badge is
     clicked — the page uses it to switch to the Findings tab with that
     finding's card expanded. Ignored by the flat DiffViewer fallback, which
     never renders a severity badge. */
  onFocusFinding?: (findingId: string) => void;
}

export function DiffTab({ prId, filesCount, files, reviews, canComment, onFocusFinding }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Smart Diff (risk-grouped) is the default view — see the render below,
  // which falls back to the flat/original-order DiffViewer only while this is
  // loading or failed to load.
  const { data: smartDiff, isLoading: smartDiffLoading, isError: smartDiffError } = useSmartDiff(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  // Smart Diff swaps in only once it has actually resolved — while loading or
  // on error, the flat viewer (unaffected by any of this) keeps rendering.
  const showSmart = !smartDiffLoading && !smartDiffError && smartDiff != null;

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? "Hide comments" : "Show comments"} ({commentCount})
            </Button>
          ) : undefined
        }
      >
        {showSmart ? t("smartDiff.groupedByRole") : `Files changed · ${filesCount} files`}
      </SectionLabel>
      {showSmart && smartDiff ? (
        <SmartDiffViewer
          data={smartDiff}
          files={files}
          reviews={reviews}
          commenting={commenting}
          onFocusFinding={onFocusFinding}
        />
      ) : (
        <DiffViewer files={files} commenting={commenting} />
      )}
    </section>
  );
}
