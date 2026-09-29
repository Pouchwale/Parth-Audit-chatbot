import { useEffect, useState } from 'react';
import type { ImageURISource } from 'react-native';
import type { FileInfo } from '@shared/api';
import { fileUrl } from './api';
import { useAuth } from './auth';

// Phones load the image themselves, sending the session token as a header. The web version of this module fetches it
// instead, as browsers' images can't carry one. These are the person's own uploads, which the server doesn't record.

/** An image to show. Once ready, the image itself may still fail to load, and says so. */
export type FileImage = { status: 'loading' } | { status: 'ready'; source: ImageURISource } | { status: 'failed' };

/** An image the person attached, to show. */
export function useFileImage(file: FileInfo): FileImage {
  const { call } = useAuth();
  const [image, setImage] = useState<FileImage>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    call(async (token) => ({ uri: fileUrl(file.id, 'open'), headers: { authorization: `Bearer ${token}` } })).then(
      (source) => {
        if (active) setImage({ status: 'ready', source });
      },
      () => {
        if (active) setImage({ status: 'failed' });
      },
    );
    return () => {
      active = false;
    };
  }, [call, file.id]);

  return image;
}
