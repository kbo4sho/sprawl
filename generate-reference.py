#!/usr/bin/env python3
"""
generate-reference.py — Generate reference images for the Living Canvas
Uses SDXL Turbo locally on Apple Silicon (MPS)

Usage:
  python3 generate-reference.py "a candlelit Dutch interior with warm amber tones" output.png
  python3 generate-reference.py --prompt "..." --output ref.png --steps 4 --size 1024
"""

import argparse
import time
import torch
from diffusers import AutoPipelineForText2Image
from PIL import Image

MODEL_ID = "stabilityai/sdxl-turbo"

def generate(prompt, output_path, steps=4, size=1024, seed=None):
    print(f"🎨 Loading SDXL Turbo...")
    start = time.time()
    
    pipe = AutoPipelineForText2Image.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float16,
        variant="fp16",
    )
    pipe = pipe.to("mps")
    
    load_time = time.time() - start
    print(f"  Model loaded in {load_time:.1f}s")
    
    # Generate
    print(f"  Prompt: {prompt[:100]}...")
    print(f"  Steps: {steps} | Size: {size}x{size}")
    
    generator = torch.Generator("mps").manual_seed(seed) if seed else None
    
    gen_start = time.time()
    image = pipe(
        prompt=prompt,
        num_inference_steps=steps,
        guidance_scale=0.0,  # SDXL Turbo doesn't use guidance
        width=size,
        height=size,
        generator=generator,
    ).images[0]
    
    gen_time = time.time() - gen_start
    print(f"  Generated in {gen_time:.1f}s")
    
    image.save(output_path)
    print(f"  ✅ Saved: {output_path}")
    
    return output_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate reference images with SDXL Turbo")
    parser.add_argument("prompt", nargs="?", help="Image prompt")
    parser.add_argument("output", nargs="?", default="/tmp/sdxl_reference.png", help="Output path")
    parser.add_argument("--prompt", dest="prompt_flag", help="Image prompt (alt)")
    parser.add_argument("--output", dest="output_flag", help="Output path (alt)")
    parser.add_argument("--steps", type=int, default=4, help="Inference steps (1-4, default 4)")
    parser.add_argument("--size", type=int, default=1024, help="Image size (default 1024)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed")
    
    args = parser.parse_args()
    prompt = args.prompt_flag or args.prompt
    output = args.output_flag or args.output
    
    if not prompt:
        print("Usage: python3 generate-reference.py 'your prompt here' [output.png]")
        exit(1)
    
    generate(prompt, output, steps=args.steps, size=args.size, seed=args.seed)
