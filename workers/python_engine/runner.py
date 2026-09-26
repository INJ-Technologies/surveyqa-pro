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
    parser.add_argument("--internal-testing", action="store_true", default=False, help="Force direct execution without proxy for internal testing")
    args = parser.parse_args()

    print(f"==================================================")
    print(f"  Starting SurveyQA Pro Python Engine")
    print(f"  Session: {args.session_id}")
    if args.internal_testing:
        print(f"  Mode: INTERNAL TESTING (Direct Connection)")
    if args.survey_url:
        print(f"  URL: {args.survey_url[:60]}...")
    print(f"==================================================")

    try:
        runner = SurveySessionRunner(
            session_id=args.session_id,
            survey_url=args.survey_url,
            internal_testing=args.internal_testing,
        )
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
