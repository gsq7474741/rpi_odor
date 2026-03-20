import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/**
 * DELETE /api/runs - 删除一个或多个 Run 及其所有关联数据
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const runIds: number[] = body.runIds;

    if (!Array.isArray(runIds) || runIds.length === 0) {
      return NextResponse.json({ error: "runIds is required" }, { status: 400 });
    }

    if (runIds.length > 20) {
      return NextResponse.json({ error: "最多一次删除 20 个 Run" }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      // 1. 查找所有关联的 sample_id
      const sampleResult = await client.query(
        "SELECT id FROM samples WHERE run_id = ANY($1)",
        [runIds]
      );
      const sampleIds = sampleResult.rows.map((r: { id: number }) => r.id);

      await client.query("BEGIN");

      if (sampleIds.length > 0) {
        // 2. 删除 sample 关联数据（无 ON DELETE CASCADE 的表）
        await client.query("DELETE FROM sample_ml_labels WHERE sample_id = ANY($1)", [sampleIds]);
        await client.query("DELETE FROM sample_phase_transitions WHERE sample_id = ANY($1)", [sampleIds]);
        await client.query("DELETE FROM sensor_readings_v2 WHERE sample_id = ANY($1)", [sampleIds]);
      }

      // 3. 删除 run（samples 表有 ON DELETE CASCADE 会自动删除）
      const result = await client.query("DELETE FROM runs WHERE id = ANY($1)", [runIds]);

      await client.query("COMMIT");

      return NextResponse.json({
        deleted: result.rowCount,
        samplesDeleted: sampleIds.length,
        runIds,
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error deleting runs:", error);
    return NextResponse.json(
      { error: "删除失败: " + String(error) },
      { status: 500 }
    );
  }
}
