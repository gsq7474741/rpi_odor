"""通过 OpenAI 兼容 API 生成 / 编辑图片的最小封装。

用法 (作为模块):
    from generate_image import generate_image

    # 文生图
    path = generate_image("a cat sitting on a desk", output_path="cat.png")

    # 图生图（带参考图）
    path = generate_image(
        "turn this into a watercolor painting",
        ref_images=["input.png"],
        output_path="output.png",
    )

用法 (命令行):
    python generate_image.py "a cat sitting on a desk" -o cat.png
    python generate_image.py "watercolor style" -o out.png -r input.png
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Iterable

import httpx
from openai import OpenAI

# ── 默认配置 ─────────────────────────────────────────
API_BASE_URL = "https://api.openai-proxy.org/v1"
API_KEY = "sk-xvv7d4n10T7EzRlosIB87OseWI2TFlM4uJRlkaHyNFMXXL3m"
DEFAULT_MODEL = "gpt-image-2"
DEFAULT_SIZE = "1024x1536"
DEFAULT_QUALITY = "medium"
DEFAULT_OUTPUT_FORMAT = "png"


# 分段超时: connect/write 较短, read 足够长 (API 端生图可能慢但一定会完成)
_TIMEOUT = httpx.Timeout(
    connect=60.0,    # 建立连接
    write=300.0,     # 上传多张参考图
    read=3600.0,     # 等待 API 生成 (60 min, 多参考图场景需要更长)
    pool=60.0,       # 连接池
)


def get_client(api_key: str = API_KEY, base_url: str = API_BASE_URL) -> OpenAI:
    """构造一个 OpenAI 客户端。"""
    return OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=_TIMEOUT,
        max_retries=0,      # 禁止自动重试, 避免超时后重复计费
    )


def _log(msg: str) -> None:
    """带时间戳的进度日志。"""
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"  [{ts}] {msg}", flush=True)


def _raw_images_edit(
    prompt: str,
    ref_paths: list[Path],
    model: str,
    size: str,
    quality: str,
    api_key: str,
    base_url: str,
) -> bytes:
    """绕过 OpenAI SDK, 用 raw httpx 调用 images/edits 并流式读取响应。

    返回解码后的图片 bytes (PNG)。
    """
    url = f"{str(base_url).rstrip('/')}/images/edits"

    files_list: list[tuple[str, tuple[str, bytes, str]]] = []
    for i, p in enumerate(ref_paths):
        data = p.read_bytes()
        suffix = p.suffix.lower()
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}.get(
            suffix, "image/png"
        )
        field_name = "image" if len(ref_paths) == 1 else "image[]"
        files_list.append((field_name, (p.name, data, mime)))
        _log(f"[edit] 参考图 #{i+1}: {p.name} ({len(data)} bytes, {mime})")

    form_data = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": "1",
    }

    headers = {"Authorization": f"Bearer {api_key}"}

    _log(f"[edit] POST {url} ...")
    t0 = time.time()

    with httpx.Client(timeout=_TIMEOUT) as http:
        resp = http.post(url, data=form_data, files=files_list, headers=headers)

    elapsed = time.time() - t0
    _log(f"[edit] 响应 status={resp.status_code}, 耗时 {elapsed:.1f}s, "
         f"body={len(resp.content)} bytes")

    if resp.status_code != 200:
        raise RuntimeError(
            f"images/edits 返回 HTTP {resp.status_code}: {resp.text[:500]}"
        )

    body = resp.json()

    data_list = body.get("data", [])
    if not data_list:
        raise RuntimeError(f"images/edits 返回空 data: {json.dumps(body)[:300]}")

    item = data_list[0]
    b64 = item.get("b64_json")
    if b64:
        _log(f"[edit] 解码 b64_json ({len(b64)} chars)...")
        return base64.b64decode(b64)

    img_url = item.get("url")
    if img_url:
        _log(f"[edit] API 返回 URL, 下载中...")
        return _download_url_bytes(img_url)

    raise RuntimeError(f"images/edits 响应既无 b64_json 也无 url: {list(item.keys())}")


def _download_url_bytes(url: str) -> bytes:
    """下载 URL 返回 bytes。"""
    with httpx.Client(timeout=httpx.Timeout(connect=30, read=300, write=30, pool=30)) as http:
        resp = http.get(url)
        resp.raise_for_status()
        return resp.content


def _download_url(url: str, out: Path) -> None:
    """下载 URL 到文件。"""
    out.write_bytes(_download_url_bytes(url))
    _log(f"已下载 -> {out}")


def generate_image(
    prompt: str,
    output_path: str | Path | None = None,
    ref_images: Iterable[str | Path] | None = None,
    *,
    client: OpenAI | None = None,
    model: str = DEFAULT_MODEL,
    size: str = DEFAULT_SIZE,
    quality: str = DEFAULT_QUALITY,
    output_format: str = DEFAULT_OUTPUT_FORMAT,
) -> Path:
    """生成或编辑一张图片，并保存到本地。

    参数:
        prompt: 文本提示词。
        output_path: 输出文件路径（含文件名）。若为 None，则保存到当前
            目录下 `image_<timestamp>.<output_format>`。
        ref_images: 可选的参考图路径列表。提供后将走 `images.edit` 接口
            (图生图)，否则走 `images.generate` 接口 (文生图)。
        client: 可选的已构造 OpenAI 客户端；为 None 时按默认配置创建。
        model / size / quality / output_format: 透传给 API 的参数。

    返回:
        实际保存的文件路径。

    异常:
        - FileNotFoundError: 参考图不存在
        - openai 抛出的 API 异常会原样向上抛出
        - RuntimeError: API 返回为空或无可解析数据
    """
    if client is None:
        client = get_client()

    ref_paths: list[Path] = [Path(p) for p in (ref_images or [])]
    for p in ref_paths:
        if not p.exists():
            raise FileNotFoundError(f"参考图不存在: {p}")

    # ── 解析输出路径 ─────────────────────
    if output_path is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out = Path(f"image_{ts}.{output_format}")
    else:
        out = Path(output_path)
    if out.parent != Path(""):
        out.parent.mkdir(parents=True, exist_ok=True)

    # ── 调用 API ─────────────────────────
    if ref_paths:
        # 图生图: 绕过 SDK, 用 raw httpx 流式读取响应 (避免大 b64 响应卡死)
        _log(f"[edit] 上传 {len(ref_paths)} 张参考图 + prompt({len(prompt)} chars)...")
        img_bytes = _raw_images_edit(
            prompt=prompt,
            ref_paths=ref_paths,
            model=model,
            size=size,
            quality=quality,
            api_key=API_KEY,
            base_url=API_BASE_URL,
        )
        out.write_bytes(img_bytes)
        _log(f"[edit] 已保存 {out} ({len(img_bytes)} bytes)")
        return out
    else:
        _log(f"[generate] prompt({len(prompt)} chars), size={size}, quality={quality}")
        t0 = time.time()
        result = client.images.generate(
            model=model,
            prompt=prompt,
            size=size,
            quality=quality,
            n=1,
            output_format=output_format,
        )
        _log(f"[generate] API 返回, 耗时 {time.time()-t0:.1f}s")

    if not result.data:
        raise RuntimeError("API 返回空数据")

    image = result.data[0]

    # ── 保存 ─────────────────────────
    if image.b64_json:
        out.write_bytes(base64.b64decode(image.b64_json))
        _log(f"[generate] 已保存 {out}")
        return out
    if getattr(image, "url", None):
        _log(f"[generate] API 返回 URL, 正在下载...")
        _download_url(image.url, out)
        return out

    raise RuntimeError("API 返回的图片既无 b64_json 也无 url")


# ── CLI ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="通过 API 生成 / 编辑图片")
    parser.add_argument("prompt", help="提示词")
    parser.add_argument("-o", "--output", help="输出文件路径")
    parser.add_argument("-r", "--ref", action="append", default=[],
                        help="参考图路径，可多次指定（提供后走图生图接口）")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--size", default=DEFAULT_SIZE)
    parser.add_argument("--quality", default=DEFAULT_QUALITY)
    parser.add_argument("--format", dest="output_format", default=DEFAULT_OUTPUT_FORMAT)
    args = parser.parse_args()

    path = generate_image(
        prompt=args.prompt,
        output_path=args.output,
        ref_images=args.ref or None,
        model=args.model,
        size=args.size,
        quality=args.quality,
        output_format=args.output_format,
    )
    print(f"已保存: {path}")


if __name__ == "__main__":
    main()
