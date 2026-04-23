import unittest

from tests.ingestion.process_raw_ingestion_job_curriculum_and_manifest_suite import *
from tests.ingestion.process_raw_ingestion_job_handbook_projection_suite import *
from tests.ingestion.process_raw_ingestion_job_handbook_reingestion_suite import *
from tests.ingestion.process_raw_ingestion_job_layout_service_client_suite import *
from tests.ingestion.process_raw_ingestion_job_mineru_api_client_suite import *
from tests.ingestion.process_raw_ingestion_job_paddle_async_client_suite import *
from tests.ingestion.process_raw_ingestion_job_parse_online_ocr_bytes_suite import *
from tests.ingestion.process_raw_ingestion_job_source_truth_image_suite import *
from tests.ingestion.process_raw_ingestion_job_source_truth_pdf_suite import *

if __name__ == "__main__":
    unittest.main()
