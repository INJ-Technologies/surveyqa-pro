"""
CLI Runner Entry Point for SurveyQA Pro Python Engine
Usage:
    python -m python_engine.runner --session-id <UUID>
"""
import argparse
import sys
from .session_runner import SurveySessionRunner


def main():
    parser = argparse.ArgumentParser(description="SurveyQA Pro Python Engine CLI Runner")
    parser.add_argument("--session-id", required=True, help="UUID of the session to execute")
    parser.add_argument("--survey-url", default=None, help="Direct survey URL to test")
    args = parser.parse_args()

    print(f"==================================================")
    print(f"  Starting SurveyQA Pro Python Engine")
    print(f"  Session: {args.session_id}")
    if args.survey_url:
        print(f"  URL: {args.survey_url[:60]}...")
    print(f"==================================================")

    try:
        runner = SurveySessionRunner(session_id=args.session_id, survey_url=args.survey_url)
        result = runner.run()
        print("\nSession Execution Result:")
        print(result)
        sys.exit(0)
    except Exception as e:
        print(f"\nFATAL ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
