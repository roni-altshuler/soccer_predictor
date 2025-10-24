import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  try {
    const [leagueName, imageName] = params.path;

    if (!leagueName || !imageName) {
      return new NextResponse('League name and image name are required', { status: 400 });
    }

    const imagePath = path.join(process.cwd(), 'fbref_data', leagueName, 'visualizations', imageName);

    try {
      const imageBuffer = await fs.readFile(imagePath);
      const contentType = `image/${imageName.split('.').pop()}`; // e.g., image/png

      return new NextResponse(imageBuffer, {
        headers: {
          'Content-Type': contentType,
        },
      });
    } catch (fileError: any) {
      if (fileError.code === 'ENOENT') {
        return new NextResponse('Image not found', { status: 404 });
      }
      console.error(`Error reading image file: ${fileError.message}`);
      return new NextResponse('Internal server error', { status: 500 });
    }
  } catch (error: any) {
    console.error(`Error in visualizations API: ${error.message}`);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
