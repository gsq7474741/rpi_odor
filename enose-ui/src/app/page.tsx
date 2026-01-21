import { ControlPanel } from "@/components/control-panel";
import { SensorPanel } from "@/components/sensor-panel";
import { LoadCellPanel } from "@/components/load-cell-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Home() {
  return (
    <div className="min-h-screen bg-background p-4">
      <Tabs defaultValue="control" className="w-full max-w-4xl mx-auto">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="control">外设控制</TabsTrigger>
          <TabsTrigger value="sensor">传感器</TabsTrigger>
          <TabsTrigger value="loadcell">称重</TabsTrigger>
        </TabsList>
        <TabsContent value="control" forceMount className="data-[state=inactive]:hidden">
          <ControlPanel />
        </TabsContent>
        <TabsContent value="sensor" forceMount className="data-[state=inactive]:hidden">
          <SensorPanel />
        </TabsContent>
        <TabsContent value="loadcell" forceMount className="data-[state=inactive]:hidden">
          <LoadCellPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
