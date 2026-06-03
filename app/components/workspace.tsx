"use client";

import { Group, Panel, Separator } from "react-resizable-panels";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ChatPanel from "./chat-panel";
import FileBrowser from "./file-browser";
import Canvas from "./canvas";
import { useWorkspaceStore } from "@/app/store/workspace";

export default function Workspace() {
  const { activeTab, setActiveTab } = useWorkspaceStore();

  return (
    <Group orientation="horizontal" className="flex-1">
      <Panel defaultSize="33%" minSize="20%" maxSize="60%">
        <div className="h-full flex flex-col border-r border-mc-gray/15 overflow-hidden">
          <ChatPanel />
        </div>
      </Panel>

      <Separator className="w-1 bg-transparent hover:bg-mc-lavender/40 data-[resize-handle-active=pointer]:bg-mc-lavender/60 transition-colors" />

      <Panel defaultSize="67%" minSize="0%" collapsible collapsedSize="0%">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
          <div className="flex items-center h-12 border-b border-mc-gray/15 px-2">
            <TabsList variant="line" className="h-full gap-1 rounded-none p-0">
              <TabsTrigger
                value="files"
                className="h-full rounded-none border-b-[3px] border-transparent px-3 text-sm font-medium text-mc-gray after:hidden data-active:border-mc-lavender data-active:text-mc-dark data-active:font-semibold data-active:bg-mc-lavender/10 hover:text-mc-dark hover:bg-mc-dark/[0.03] transition-colors"
              >
                File Browser
              </TabsTrigger>
              <TabsTrigger
                value="canvas"
                className="h-full rounded-none border-b-[3px] border-transparent px-3 text-sm font-medium text-mc-gray after:hidden data-active:border-mc-lavender data-active:text-mc-dark data-active:font-semibold data-active:bg-mc-lavender/10 hover:text-mc-dark hover:bg-mc-dark/[0.03] transition-colors"
              >
                Canvas
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="files" keepMounted className="flex-1 mt-0 overflow-hidden">
            <FileBrowser />
          </TabsContent>

          <TabsContent value="canvas" keepMounted className="flex-1 mt-0 overflow-hidden">
            <Canvas />
          </TabsContent>
        </Tabs>
      </Panel>
    </Group>
  );
}
