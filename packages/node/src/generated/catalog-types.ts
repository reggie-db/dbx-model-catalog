// Generated from model-catalog.schema.json. Do not edit by hand.

/**
 * Published Databricks model catalog with identity, capabilities, availability, pricing, lifecycle, rankings, and benchmarks.
 */
export interface ModelCatalog {
  /**
   * Version of the published catalog contract.
   */
  schema_version: 11;
  /**
   * Latest source-fetch timestamp represented by the catalog.
   */
  updated_at: string;
  /**
   * Models keyed by Databricks serving endpoint or model service identifier.
   */
  models: {
    [k: string]: CatalogModel;
  };
}
/**
 * Published statistics for one Databricks model.
 */
export interface CatalogModel {
  /**
   * Canonical model name from Databricks documentation.
   */
  name: string;
  /**
   * Consolidated description of the model and intended use.
   */
  description: string;
  /**
   * Alternative names and identifiers; excludes the catalog key.
   */
  aliases: string[];
  /**
   * Normalized model type.
   */
  type:
    | "chat"
    | "image"
    | "video"
    | "embedding"
    | "reranking"
    | "decision"
    | "transcription"
    | "speech"
    | "realtime"
    | "extraction"
    | "audio";
  /**
   * Model family used to group related versions.
   */
  family?: string;
  /**
   * Organization that develops or publishes the model.
   */
  publisher?: string;
  /**
   * Model license or upstream license classification.
   */
  license?: string;
  /**
   * Whether model weights are publicly available.
   */
  open_weights?: boolean;
  /**
   * Current normalized lifecycle state.
   */
  status: "active" | "preview" | "alpha" | "beta" | "legacy" | "deprecated" | "retired";
  /**
   * Model release date.
   */
  release_date?: string;
  /**
   * Latest known model revision or metadata date.
   */
  last_updated?: string;
  /**
   * Latest date covered by the model's stated training knowledge.
   */
  knowledge_cutoff?: string;
  /**
   * Databricks retirement and replacement information.
   */
  retirement?: {
    /**
     * Retirement schedules by serving offering.
     *
     * Items: Retirement dates for one serving offering.
     */
    schedules: {
      /**
       * Serving offering affected by this retirement schedule.
       */
      offering: string;
      /**
       * Retirement dates documented for the offering.
       *
       * Items: ISO 8601 calendar date in YYYY-MM-DD format.
       */
      dates: string[];
    }[];
    /**
     * Catalog key of the recommended replacement model when matched.
     */
    replacement?: string;
    /**
     * Documented replacement model name when no catalog key is matched.
     */
    replacement_name?: string;
  };
  /**
   * Model input and output modalities.
   */
  modalities: {
    /**
     * Modalities accepted by the model.
     *
     * Items: Model input or output modality.
     */
    input: (
      ("text" | "image" | "audio" | "video" | "application/pdf" | "embedding" | "reranking" | "decision") | string
    )[];
    /**
     * Modalities produced by the model.
     *
     * Items: Model input or output modality.
     */
    output: (
      ("text" | "image" | "audio" | "video" | "application/pdf" | "embedding" | "reranking" | "decision") | string
    )[];
  };
  /**
   * Capabilities used to select the model for a workload.
   */
  capabilities: {
    /**
     * Whether requests can include image, audio, video, or PDF attachments.
     */
    attachments?: boolean;
    /**
     * Whether the model supports tool or function calling.
     */
    tools?: boolean;
    /**
     * Whether the model supports schema-constrained output.
     */
    structured_output?: boolean;
    /**
     * Whether the model supports temperature sampling.
     */
    temperature?: boolean;
    /**
     * Whether reasoning content can be interleaved with the answer.
     */
    interleaved_reasoning?: boolean;
    /**
     * Whether Databricks documents native web search support.
     */
    web_search: boolean;
    /**
     * Reasoning support and controls when known.
     */
    reasoning?:
      | {
          /**
           * The model does not support explicit reasoning controls.
           */
          supported: false;
        }
      | {
          /**
           * The model supports explicit reasoning controls.
           */
          supported: true;
          /**
           * Supported reasoning effort levels.
           *
           * Items: Normalized reasoning effort level.
           */
          effort?: ("none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "default")[];
          /**
           * Default reasoning effort when no level is specified.
           */
          default_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "default";
          /**
           * Whether reasoning can be explicitly enabled or disabled.
           */
          toggle?: boolean;
          /**
           * Supported reasoning-token budget range.
           */
          budget?: {
            /**
             * Minimum supported reasoning-token budget.
             */
            min?: number;
            /**
             * Maximum supported reasoning-token budget.
             */
            max?: number;
          };
          /**
           * Combined Databricks description of reasoning behavior.
           */
          description?: string;
        };
  };
  /**
   * Documented token limits.
   */
  limits?: {
    /**
     * Maximum context window in tokens.
     */
    context?: number;
    /**
     * Maximum input length in tokens.
     */
    input?: number;
    /**
     * Maximum generated output length in tokens.
     */
    output?: number;
  };
  /**
   * High-level tasks documented for the model.
   */
  tasks: string[];
  /**
   * Example use cases documented for the model.
   */
  use_cases: string[];
  /**
   * Availability keyed by Databricks cloud provider.
   */
  availability: {
    /**
     * Model availability on one Databricks cloud provider.
     */
    [k: string]: {
      /**
       * Lifecycle state for this cloud-provider deployment.
       */
      status: "active" | "preview" | "alpha" | "beta" | "legacy" | "deprecated" | "retired";
      /**
       * Serving modes documented or priced for this deployment.
       *
       * Items: Databricks serving mode available for the model.
       */
      serving_modes: ("pay_per_token" | "priority_pay_per_token" | "provisioned_throughput" | "batch")[];
      /**
       * Additional Databricks availability details.
       */
      details?: string;
    };
  };
  /**
   * Average Databricks DBU and USD prices for each cloud provider.
   */
  price: {
    /**
     * Available DBU and USD prices.
     */
    [k: string]: {
      /**
       * Normalized Databricks price in one currency.
       */
      [k: string]: {
        /**
         * Quantity to which the rates apply.
         */
        unit: "per_million_tokens" | "per_hour" | "per_hour_per_50_model_units";
        /**
         * Rates keyed by billing dimension.
         */
        rates: {
          [k: string]: number;
        };
      };
    };
  };
  /**
   * Average Databricks DBU and USD price across cloud providers and matched pricing variants.
   */
  average_price: {
    /**
     * Normalized Databricks price in one currency.
     */
    [k: string]: {
      /**
       * Quantity to which the rates apply.
       */
      unit: "per_million_tokens" | "per_hour" | "per_hour_per_50_model_units";
      /**
       * Rates keyed by billing dimension.
       */
      rates: {
        [k: string]: number;
      };
    };
  };
  /**
   * Deduplicated Databricks documentation notices.
   *
   * Items: Important Databricks documentation notice.
   */
  notices: {
    /**
     * Documentation notice kind.
     */
    kind: ("note" | "important" | "warning" | "tip" | "caution" | "info") | string;
    /**
     * Notice title when it adds information beyond the kind.
     */
    title?: string;
    /**
     * Deduplicated notice text.
     */
    text: string;
  }[];
  /**
   * Competitive leaderboard rankings matched to the model.
   *
   * Items: Competitive leaderboard ranking.
   */
  rankings: (
    | {
        /**
         * Leaderboard domain or configuration.
         */
        domain: string;
        /**
         * Leaderboard category within the domain.
         */
        category: string;
        /**
         * One-based leaderboard rank.
         */
        rank: number;
        /**
         * Leaderboard publication date.
         */
        published_at?: string;
        /**
         * Evaluated model variant when it differs from the base model.
         */
        variant?: {
          /**
           * Whether the evaluated variant used reasoning.
           */
          reasoning?: boolean;
          /**
           * Reasoning effort used by the evaluated variant.
           */
          reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "default";
          /**
           * Reasoning execution mode used by the evaluated variant.
           */
          reasoning_mode?: "auto" | "thinking";
          /**
           * Agent or evaluation harness used for the result.
           */
          harness?: string;
          /**
           * Context-window size used by the evaluated variant.
           */
          context?: number;
        };
        /**
         * This ranking uses a preference rating.
         */
        metric: "rating";
        /**
         * Central rating estimate.
         */
        rating: number;
        /**
         * Lower confidence bound.
         */
        lower: number;
        /**
         * Upper confidence bound.
         */
        upper: number;
        /**
         * Estimated rating variance.
         */
        variance: number;
        /**
         * Human preference votes used for the rating.
         */
        votes: number;
      }
    | {
        /**
         * Leaderboard domain or configuration.
         */
        domain: string;
        /**
         * Leaderboard category within the domain.
         */
        category: string;
        /**
         * One-based leaderboard rank.
         */
        rank: number;
        /**
         * Leaderboard publication date.
         */
        published_at?: string;
        /**
         * Evaluated model variant when it differs from the base model.
         */
        variant?: {
          /**
           * Whether the evaluated variant used reasoning.
           */
          reasoning?: boolean;
          /**
           * Reasoning effort used by the evaluated variant.
           */
          reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "default";
          /**
           * Reasoning execution mode used by the evaluated variant.
           */
          reasoning_mode?: "auto" | "thinking";
          /**
           * Agent or evaluation harness used for the result.
           */
          harness?: string;
          /**
           * Context-window size used by the evaluated variant.
           */
          context?: number;
        };
        /**
         * This ranking uses an evaluation score.
         */
        metric: "score";
        /**
         * Central score estimate.
         */
        score: number;
        /**
         * Lower confidence bound.
         */
        lower: number;
        /**
         * Upper confidence bound.
         */
        upper: number;
        /**
         * Observations used to estimate the score.
         */
        observations: number;
        /**
         * Evaluation sessions, or null when not reported.
         */
        sessions: number | null;
      }
  )[];
  /**
   * Task-suite benchmark results matched to the model.
   *
   * Items: Task-suite benchmark result.
   */
  benchmarks: {
    /**
     * Benchmark category or task-suite name.
     */
    name: string;
    /**
     * One-based benchmark rank.
     */
    rank: number;
    /**
     * Benchmark score.
     */
    score: number;
    /**
     * Tasks represented by the benchmark score.
     */
    task_count: number;
    /**
     * Benchmark publication date.
     */
    published_at?: string;
    /**
     * Evaluated model variant when it differs from the base model.
     */
    variant?: {
      /**
       * Whether the evaluated variant used reasoning.
       */
      reasoning?: boolean;
      /**
       * Reasoning effort used by the evaluated variant.
       */
      reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "default";
      /**
       * Reasoning execution mode used by the evaluated variant.
       */
      reasoning_mode?: "auto" | "thinking";
      /**
       * Agent or evaluation harness used for the result.
       */
      harness?: string;
      /**
       * Context-window size used by the evaluated variant.
       */
      context?: number;
    };
  }[];
}
