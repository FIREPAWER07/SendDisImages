use anyhow::{anyhow, Result};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageFormat};
use oxipng;
use std::path::{Path, PathBuf};
use tokio::fs;

pub async fn process_image(path: &Path, max_size: usize) -> Result<PathBuf> {
    // Check if file exists
    if !path.exists() {
        return Err(anyhow!("File does not exist"));
    }

    // Get file extension
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .ok_or_else(|| anyhow!("Invalid file extension"))?
        .to_lowercase();

    // Read original file size
    let metadata = fs::metadata(path).await?;
    let file_len: u64 = metadata.len();
    let original_size: usize = file_len as usize;

    // If already under limit, return original
    if original_size <= max_size {
        return Ok(path.to_path_buf());
    }

    // Create temp directory for compressed images
    let temp_dir = std::env::temp_dir().join("senddisimages");
    fs::create_dir_all(&temp_dir).await?;

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow!("Invalid filename"))?;

    let output_path = temp_dir.join(format!("compressed_{}", filename));

    match extension.as_str() {
        "jpg" | "jpeg" => {
            compress_jpeg(path, &output_path, max_size).await?;
        }
        "png" => {
            compress_png(path, &output_path, max_size).await?;
        }
        _ => {
            return Err(anyhow!("Unsupported image format: {}", extension));
        }
    }

    // Verify compressed size
    let compressed_metadata = fs::metadata(&output_path).await?;
    let compressed_len: u64 = compressed_metadata.len();
    let compressed_size: usize = compressed_len as usize;

    if compressed_size > max_size {
        let _ = fs::remove_file(&output_path).await;
        return Err(anyhow!(
            "Image exceeds size limit even after compression ({} MB limit)",
            max_size / 1024 / 1024
        ));
    }

    Ok(output_path)
}

async fn compress_jpeg(input: &Path, output: &Path, max_size: usize) -> Result<()> {
    let img_data = fs::read(input).await?;
    let img = image::load_from_memory(&img_data)?;

    // Try different quality levels
    for quality in (60..=95).rev().step_by(5) {
        let compressed = compress_jpeg_with_quality(&img, quality)?;

        if compressed.len() <= max_size {
            fs::write(output, compressed).await?;
            return Ok(());
        }
    }

    // If still too large, try resizing
    let img_len = img_data.len() as f64;
    let scale_factor = ((max_size as f64) / img_len).sqrt();
    let img_width: u32 = img.width();
    let img_height: u32 = img.height();
    let new_width = ((img_width as f64) * scale_factor) as u32;
    let new_height = ((img_height as f64) * scale_factor) as u32;

    let resized = img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3);
    let compressed = compress_jpeg_with_quality(&resized, 85)?;

    fs::write(output, compressed).await?;
    Ok(())
}

fn compress_jpeg_with_quality(img: &DynamicImage, quality: u8) -> Result<Vec<u8>> {
    let rgb_img = img.to_rgb8();
    let (width, height) = rgb_img.dimensions();

    let mut output = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut output, quality);

    encoder
        .encode(&rgb_img, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| anyhow!("JPEG encoding failed: {}", e))?;

    Ok(output)
}

async fn compress_png(input: &Path, output: &Path, max_size: usize) -> Result<()> {
    let img_data = fs::read(input).await?;

    // Try oxipng optimization first
    let options = oxipng::Options {
        optimize_alpha: true,
        bit_depth_reduction: true,
        color_type_reduction: true,
        palette_reduction: true,
        grayscale_reduction: true,
        ..oxipng::Options::from_preset(6)
    };

    let optimized = oxipng::optimize_from_memory(&img_data, &options)
        .map_err(|e| anyhow!("PNG optimization failed: {}", e))?;

    if optimized.len() <= max_size {
        fs::write(output, optimized).await?;
        return Ok(());
    }

    // If still too large, resize and try again
    let img = image::load_from_memory(&img_data)?;
    let img_len = img_data.len() as f64;
    let scale_factor = ((max_size as f64) / img_len).sqrt();
    let img_width: u32 = img.width();
    let img_height: u32 = img.height();
    let new_width = ((img_width as f64) * scale_factor) as u32;
    let new_height = ((img_height as f64) * scale_factor) as u32;

    let resized = img.resize(new_width, new_height, image::imageops::FilterType::Lanczos3);

    let mut buffer = Vec::new();
    resized.write_to(&mut std::io::Cursor::new(&mut buffer), ImageFormat::Png)?;

    let optimized = oxipng::optimize_from_memory(&buffer, &options)
        .map_err(|e| anyhow!("PNG optimization failed: {}", e))?;

    fs::write(output, optimized).await?;
    Ok(())
}
