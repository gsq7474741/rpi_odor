import { ControlPanel } from "@/components/control-panel";
import { SensorPanel } from "@/components/sensor-panel";
import { LoadCellPanel } from "@/components/load-cell-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SystemPage() {
  return (
    <div className="min-h-screen bg-background p-4">
      <div className="w-full max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">系统功能</h1>
        <Tabs defaultValue="control" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="control">外设控制</TabsTrigger>
          <TabsTrigger value="sensor">传感器</TabsTrigger>
          <TabsTrigger value="loadcell">称重</TabsTrigger>
        </TabsList>
        <TabsContent value="control" forceMount className="data-[state=inactive]:hidden mt-6">
          <ControlPanel />
        </TabsContent>
        <TabsContent value="sensor" forceMount className="data-[state=inactive]:hidden mt-6">
          <SensorPanel />
        </TabsContent>
        <TabsContent value="loadcell" forceMount className="data-[state=inactive]:hidden mt-6">
          <LoadCellPanel />
        </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
