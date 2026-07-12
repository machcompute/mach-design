import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
  useComposerRuntime,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  Code2Icon,
  PresentationIcon,
  XIcon,
} from "lucide-react";
import type { FC } from "react";
import { useChatBridgeStore } from "@/app/store/chat-bridge";
import { useEngineStore } from "@/app/store/engine";
import { useSettingsStore } from "@/app/store/settings";

const ReferencePill: FC = () => {
  const reference = useChatBridgeStore((s) => s.reference);
  const clear = useChatBridgeStore((s) => s.clear);
  if (!reference) return null;
  const Icon = reference.kind === "template" ? PresentationIcon : Code2Icon;
  return (
    <div className="flex items-center gap-1.5 w-fit max-w-full px-2 py-1 bg-mc-mint/15 border border-mc-mint/30 rounded-md text-xs text-mc-dark">
      <Icon className="w-3 h-3 shrink-0 text-mc-gray" />
      <span className="truncate font-mono">{reference.label}</span>
      <button
        type="button"
        onClick={clear}
        className="shrink-0 text-mc-gray hover:text-red-500 transition-colors"
        aria-label="Remove reference"
      >
        <XIcon className="w-3 h-3" />
      </button>
    </div>
  );
};

export const Thread: FC = () => {
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-radius" as string]: "24px",
        ["--composer-padding" as string]: "10px",
      }}
    >
      <ThreadPrimitive.Viewport
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth"
      >
        <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4">
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <ThreadWelcome />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            className="mb-10 flex flex-col gap-y-8 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer bg-background sticky bottom-0 mt-auto flex flex-col gap-4 overflow-visible rounded-t-(--composer-radius) pb-4 md:pb-6">
            <ThreadScrollToBottom />
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom render={<TooltipIconButton tooltip="Scroll to bottom" variant="outline" className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible" />}><ArrowDownIcon /></ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root my-auto flex grow flex-col">
      <div className="aui-thread-welcome-center flex w-full grow flex-col items-center justify-center">
        <div className="aui-thread-welcome-message flex size-full flex-col justify-center px-4">
          <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
            Hello there!
          </h1>
          <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-muted-foreground text-xl delay-75 duration-200">
            How can I help you today?
          </p>
        </div>
      </div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions grid w-full gap-2 pb-4 @md:grid-cols-2">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200 nth-[n+3]:hidden @md:nth-[n+3]:block">
      <SuggestionPrimitive.Trigger send render={<Button variant="ghost" className="aui-thread-welcome-suggestion bg-background hover:bg-muted h-auto w-full flex-wrap items-start justify-start gap-1 rounded-3xl border px-4 py-3 text-start text-sm transition-colors @md:flex-col" />}><SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 font-medium" /><SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" /></SuggestionPrimitive.Trigger>
    </div>
  );
};

const Composer: FC = () => {
  const composer = useComposerRuntime();
  const materializeReference = () => {
    const { reference, clear } = useChatBridgeStore.getState();
    if (!reference) return;
    // Keep an explicit, compact marker in the user message so the history can
    // render a pill without having to reverse-engineer the reference prose.
    const marker = `[[mach-reference:${reference.kind ?? "element"}:${encodeURIComponent(reference.label)}]]\n`;
    const referenceContent = `[[mach-reference-content]]\n${reference.content}[[/mach-reference-content]]\n`;
    composer.setText(marker + referenceContent + composer.getState().text);
    clear();
  };

  return (
    <ComposerPrimitive.Root
      className="aui-composer-root relative flex w-full flex-col"
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) materializeReference();
      }}
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('[aria-label="Send message"]')) materializeReference();
      }}
    >
      <ComposerPrimitive.AttachmentDropzone render={<div data-slot="aui_composer-shell" className="bg-background focus-within:border-ring/75 focus-within:ring-ring/20 data-[dragging=true]:border-ring data-[dragging=true]:bg-accent/50 flex w-full flex-col gap-2 rounded-(--composer-radius) border p-(--composer-padding) transition-shadow focus-within:ring-2 data-[dragging=true]:border-dashed" />}><ReferencePill /><ComposerAttachments /><ComposerPrimitive.Input
                      placeholder="Send a message..."
                      className="aui-composer-input placeholder:text-muted-foreground/80 max-h-32 min-h-10 w-full resize-none bg-transparent px-1.75 py-1 text-sm outline-none"
                      rows={1}
                      autoFocus
                      aria-label="Message input"
                    /><ComposerAction /></ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <div className="flex items-center gap-2">
        <ComposerAddAttachment />
        <ContextUsageRing />
      </div>
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send render={<TooltipIconButton tooltip="Send message" side="bottom" type="button" variant="default" size="icon" className="aui-composer-send size-8 rounded-full" aria-label="Send message" />}><ArrowUpIcon className="aui-composer-send-icon size-4" /></ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel render={<Button type="button" variant="default" size="icon" className="aui-composer-cancel size-8 rounded-full" aria-label="Stop generating" />}><SquareIcon className="aui-composer-cancel-icon size-3 fill-current" /></ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

const ContextUsageRing: FC = () => {
  const provider = useSettingsStore((s) => s.provider);
  const used = useEngineStore((s) => s.contextUsedTokens);
  const max = useEngineStore((s) => s.contextMaxTokens);
  const hasContext = max > 0;
  // Context tracking only exists for the local WebGPU engine.
  if (provider !== "webgpu") return null;
  const pct = hasContext ? Math.min(1, Math.max(0, used / max)) : 0;
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const remaining = circumference * (1 - pct);
  const percentLabel = Math.round(pct * 100);
  const title = hasContext
    ? `${used.toLocaleString()} / ${max.toLocaleString()} context tokens used (${percentLabel}%)`
    : "Local context usage unavailable";

  return (
    <div
      className="relative flex size-8 shrink-0 items-center justify-center rounded-full text-mc-gray"
      title={title}
      aria-label={title}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={hasContext ? max : 100}
      aria-valuenow={hasContext ? used : 0}
    >
      <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="opacity-20"
        />
        <circle
          cx="12"
          cy="12"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={remaining}
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-300",
            pct >= 0.9 ? "text-red-500" : pct >= 0.7 ? "text-amber-500" : "text-mc-dark"
          )}
        />
      </svg>
      <span className="absolute text-[9px] font-medium tabular-nums leading-none text-mc-gray">
        {percentLabel}
      </span>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  // reserves space for action bar and compensates with `-mb` for consistent msg spacing
  // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
  // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        // [contain-intrinsic-size:auto_24px] fixes issue #4104, don't change without checking for regressions
        className="text-foreground px-2 leading-relaxed wrap-break-word [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
      >
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ["group-chainOfThought", "group-reasoning"],
            "tool-call": ["group-chainOfThought", "group-tool"],
            "standalone-tool-call": [],
          })}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-reasoning": {
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot defaultOpen={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "group-tool":
                return (
                  <ToolGroupRoot>
                    <ToolGroupTrigger
                      count={part.indices.length}
                      active={part.status.type === "running"}
                    />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallback {...part} />;
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="animate-pulse font-sans"
                    aria-label="Assistant is working"
                  >
                    {"●"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground col-start-3 row-start-2 -ms-1 flex gap-1"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="Copy" />}><AuiIf condition={(s) => s.message.isCopied}>
                      <CheckIcon />
                    </AuiIf><AuiIf condition={(s) => !s.message.isCopied}>
                      <CopyIcon />
                    </AuiIf></ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload render={<TooltipIconButton tooltip="Refresh" />}><RefreshCwIcon /></ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger render={<TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent" />}><MoreHorizontalIcon /></ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="aui-action-bar-more-content bg-popover text-popover-foreground z-50 min-w-32 overflow-hidden rounded-md border p-1 shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown render={<ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none" />}><DownloadIcon className="size-4" />Export as Markdown
                              </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

// References can originate from either a TSX canvas element or a structured
// slide-deck element. Keep the composer presentation neutral so both remain
// compact and readable in the conversation.
const REFERENCE_RE = /^Regarding this (?:slide )?element in `([^`]+)` \(at ([^)]+)\):\n\n```(?:tsx|json)\n[\s\S]*?\n```\s*/;
const REFERENCE_MARKER_RE = /^\[\[mach-reference:(element|template):([^\]]+)\]\]\n/;
const REFERENCE_CONTENT_RE = /^\[\[mach-reference-content\]\]\n[\s\S]*?\[\[\/mach-reference-content\]\]\n?/;
const TEMPLATE_REFERENCE_RE = /^Use the uploaded PowerPoint template `([^`]+)` to generate a slide deck\. First call `inspect_potx_template` on it, then create and lint a template-bound slide deck\.\s*/;

function decodeReferenceLabel(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function HistoryReferencePill({ label, kind, title }: { label: string; kind: "element" | "template"; title?: string }) {
  const Icon = kind === "template" ? PresentationIcon : Code2Icon;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded border border-mc-mint/40 bg-mc-mint/20 px-2 py-0.5 font-mono text-[11px] text-mc-dark"
      title={title ?? label}
    >
      <Icon className="size-3 shrink-0 text-mc-gray" />
      <span className="truncate">{label}</span>
    </span>
  );
}

const UserParts: FC = () => {
  const text = useAuiState((s) =>
    (s.message.content as { type: string; text?: string }[])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
  );
  const marker = text.match(REFERENCE_MARKER_RE);
  if (marker) {
    const kind = marker[1] === "template" ? "template" : "element";
    const label = decodeReferenceLabel(marker[2]);
    const afterMarker = text.slice(marker[0].length);
    const hiddenReference = afterMarker.match(REFERENCE_CONTENT_RE);
    const rest = afterMarker.slice(hiddenReference?.[0].length ?? 0).trim();
    return (
      <div className="flex flex-col items-start gap-1.5">
        <HistoryReferencePill label={label} kind={kind} />
        {rest && <span className="whitespace-pre-wrap">{rest}</span>}
      </div>
    );
  }

  const match = text.match(REFERENCE_RE);
  if (!match) {
    const templateMatch = text.match(TEMPLATE_REFERENCE_RE);
    if (!templateMatch) return <MessagePrimitive.Parts />;
    const file = templateMatch[1].split("/").pop() ?? templateMatch[1];
    const rest = text.slice(templateMatch[0].length).trim();
    return (
      <div className="flex flex-col items-start gap-1.5">
        <HistoryReferencePill label={`${file} · slide template`} kind="template" title={templateMatch[1]} />
        {rest && <span className="whitespace-pre-wrap">{rest}</span>}
      </div>
    );
  }

  const file = match[1].split("/").pop() ?? match[1];
  const rest = text.slice(match[0].length).trim();
  return (
    <div className="flex flex-col items-start gap-1.5">
      <HistoryReferencePill label={`${file} · ${match[2]}`} kind="element" title={`${match[1]} · ${match[2]}`} />
      {rest && <span className="whitespace-pre-wrap">{rest}</span>}
    </div>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_60px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-2xl px-4 py-2.5 wrap-break-word empty:hidden">
          <UserParts />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit render={<TooltipIconButton tooltip="Edit" className="aui-user-action-edit p-4" />}><PencilIcon /></ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root bg-muted ms-auto flex w-full max-w-[85%] flex-col rounded-2xl">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent p-4 text-sm outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel render={<Button variant="ghost" size="sm" />}>Cancel
                              </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button size="sm" />}>Update</ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous render={<TooltipIconButton tooltip="Previous" />}><ChevronLeftIcon /></BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next render={<TooltipIconButton tooltip="Next" />}><ChevronRightIcon /></BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
